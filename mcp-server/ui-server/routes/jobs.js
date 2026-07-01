"use strict";
const fs   = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { json } = require("../lib/http");
const { openStream, pingInterval } = require("../lib/sse");
const csrf = require("../lib/csrf");
const {
  JOBS_DIR, jobPath, readJob, createJob, answerQuestion, listJobs,
  planPrune, executePrune,
} = require("../lib/jobs");
const { listServerNames } = require("../lib/exec");

/* Choose worker (WS1 / D-019 — two-phase by default):
   - DOKPILOT_WORKER=mock   → lib/mock-worker.js   (deterministic demo loop, no
                               Claude required, doesn't actually deploy)
   - DOKPILOT_WORKER=claude → lib/claude-worker.js (Phase B ONLY — resume/back-compat
                               of a job that already carries a manifest; skips analysis)
   - default                → lib/analyze-worker.js (Phase A: read-only analyze → emit
                               validated manifest → spawn Phase B claude-worker.js)
   All are detached + unref'd so the ui-server can restart without killing
   in-flight workers. The worker is spawned WITHOUT the ui-server bearer token. */
function spawnWorker(id) {
  const which = process.env.DOKPILOT_WORKER || "analyze";
  const file = which === "mock" ? "mock-worker.js"
    : which === "claude" ? "claude-worker.js"   // Phase B only (resume/back-compat)
    : "analyze-worker.js";                        // default: two-phase (Phase A → B)
  const workerPath = path.join(__dirname, "..", "lib", file);
  const child = spawn(process.execPath, [workerPath, id], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

/** Read the JSON body of a request (with 64KB cap). */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (c) => {
      length += c.length;
      if (length > max) {
        reject(Object.assign(new Error("body too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const buf = Buffer.concat(chunks).toString("utf8");
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(Object.assign(new Error("invalid json: " + e.message), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

/* GET /api/jobs?status=&limit= — list jobs (newest first).
   Backs the deploy-history page. status accepts a CSV ("done,error") or a
   single value; limit caps the result (default 100). cost_usd is included so
   the history list can show usage per row without a per-job fetch. */
function listAll(req, res) {
  const all = listJobs().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const wanted = (req.query?.status || "").split(",").map((s) => s.trim()).filter(Boolean);
  const lim = Math.max(1, Math.min(500, Number(req.query?.limit) || 100));
  const filtered = wanted.length ? all.filter((j) => wanted.includes(j.status)) : all;
  json(res, 200, {
    jobs: filtered.slice(0, lim).map((j) => ({
      id: j.id,
      status: j.status,
      repo: j.repo,
      server: j.server,
      branch: j.branch,
      domain: j.domain,
      created_at: j.created_at,
      updated_at: j.updated_at,
      result: j.result,
      error: j.error,
      cost_usd: j.cost_usd,
    })),
    count: filtered.length,
    total: all.length,
  });
}

/* GET /api/jobs/stats — rollups for the history page header
   (cost + count over all-time / 7d / 24h, plus by-status). */
function jobsStats(req, res) {
  const all = listJobs();
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const stats = {
    total: all.length,
    by_status: {},
    cost: { all_time: 0, last_7d: 0, last_24h: 0 },
    count: { last_7d: 0, last_24h: 0 },
    earliest: null,
    latest: null,
  };
  for (const j of all) {
    stats.by_status[j.status] = (stats.by_status[j.status] || 0) + 1;
    const c = typeof j.cost_usd === "number" ? j.cost_usd : 0;
    stats.cost.all_time += c;
    if (j.created_at) {
      const t = Date.parse(j.created_at);
      if (!stats.earliest || j.created_at < stats.earliest) stats.earliest = j.created_at;
      if (!stats.latest   || j.created_at > stats.latest)   stats.latest   = j.created_at;
      const age = now - t;
      if (age <= 7 * DAY) { stats.cost.last_7d += c; stats.count.last_7d += 1; }
      if (age <= 1 * DAY) { stats.cost.last_24h += c; stats.count.last_24h += 1; }
    }
  }
  // 2-decimal cents for display sanity
  stats.cost.all_time = Math.round(stats.cost.all_time * 100) / 100;
  stats.cost.last_7d  = Math.round(stats.cost.last_7d  * 100) / 100;
  stats.cost.last_24h = Math.round(stats.cost.last_24h * 100) / 100;
  json(res, 200, stats);
}

/* POST /api/jobs/prune — preview or apply a prune policy to the jobs dir.
   Body: { policy?, dry_run? } — defaults: dry_run=true (preview only).
   Returns the same plan shape whether dry-run or not, plus files_removed
   when applied. CSRF-gated. In-flight jobs are never selected. */
async function prune(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const policy = body?.policy || {};
  const dryRun = body?.dry_run !== false; // default true for safety
  const plan = planPrune(policy);
  if (dryRun) return json(res, 200, { dry_run: true, ...plan });
  const files_removed = executePrune(plan.delete);
  json(res, 200, { dry_run: false, files_removed, ...plan });
}

/* DELETE /api/jobs/:id — remove the job's persisted state (job.json + the
   matching claude.log). Used by the history page Delete action. Idempotent;
   if the files don't exist, returns 200 with deleted:false. */
function deleteJob(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let removed = 0;
  try {
    const p = jobPath(params.id);
    if (fs.existsSync(p)) { fs.unlinkSync(p); removed++; }
    const log = p.replace(/\.json$/, ".claude.log");
    if (fs.existsSync(log)) { fs.unlinkSync(log); removed++; }
  } catch (e) {
    return json(res, 500, { error: "delete-failed", message: e.message });
  }
  json(res, 200, { deleted: removed > 0, id: params.id, files_removed: removed });
}

/* POST /api/jobs/deploy — create a new deploy job */
async function createDeploy(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body || typeof body !== "object") return json(res, 400, { error: "missing-body" });

  const { repo, server, branch, domain } = body;
  if (!repo || typeof repo !== "string") return json(res, 400, { error: "missing-repo" });

  // Sanity check: server must be configured
  const known = listServerNames();
  if (!server || !known.includes(server)) {
    return json(res, 400, { error: "unknown-server", known });
  }

  // Normalize repo — accept "github.com/owner/repo" or full URL
  let repoNorm = repo.trim();
  if (repoNorm.startsWith("https://")) repoNorm = repoNorm.replace(/^https?:\/\//, "");
  if (repoNorm.endsWith(".git")) repoNorm = repoNorm.slice(0, -4);
  if (!/^github\.com\/[^/]+\/[^/]+/.test(repoNorm)) {
    return json(res, 400, { error: "invalid-repo", hint: "format: github.com/owner/name" });
  }

  const job = createJob({
    repo: repoNorm,
    server,
    branch: branch || "main",
    domain: domain || null,
  });

  // Kick the worker. Default: claude-worker (real). Override with
  // DOKPILOT_WORKER=mock to use the deterministic demo loop.
  try { spawnWorker(job.id); } catch (e) {
    console.error("[ui] worker spawn failed:", e);
  }

  json(res, 201, { id: job.id, job });
}

/* GET /api/jobs/:id — current state */
function getJob(req, res, ctx, params) {
  const job = readJob(params.id);
  if (!job) return json(res, 404, { error: "not-found", id: params.id });
  json(res, 200, { job });
}

/* POST /api/jobs/:id/answer — submit a question answer */
async function postAnswer(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body?.questionId || body.answer === undefined) {
    return json(res, 400, { error: "missing-questionId-or-answer" });
  }
  const job = answerQuestion(params.id, body.questionId, body.answer);
  if (!job) return json(res, 404, { error: "not-found", id: params.id });
  json(res, 200, { job });
}

/* GET /api/jobs/:id/stream — SSE: emit current job, then re-emit on
   every fs.watch change. Auto-close when status reaches done/error. */
function streamJob(req, res, ctx, params) {
  const id = params.id;
  const p = jobPath(id);
  const stream = openStream(res);

  // Hold the stream open past a terminal status long enough for the worker's
  // trailing `cost_usd` write (it lands a beat after the worker marks done,
  // on the claude process exit). Reschedulable so we close ~quickly once cost
  // is present, but never hang longer than the grace cap.
  let closeTimer = null;
  const scheduleClose = (reason, delay) => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => stream.close(reason), delay);
  };

  const emit = () => {
    const j = readJob(id);
    if (!j) {
      stream.send("not-found", { id });
      stream.close("not-found");
      return;
    }
    stream.send("job", j);
    if (j.status === "done" || j.status === "error") {
      // cost present → close promptly; not yet → wait up to 8s for the
      // trailing write (fs.watch re-emits with cost in between).
      scheduleClose("terminal", j.cost_usd != null ? 400 : 8000);
    }
  };

  // Initial emit
  emit();

  // fs.watch is debounced via a tiny tail-latch. POSIX may double-fire.
  let pending = null;
  let watcher = null;
  try {
    watcher = fs.watch(JOBS_DIR, (ev, fname) => {
      if (fname !== path.basename(p)) return;
      clearTimeout(pending);
      pending = setTimeout(emit, 50);
    });
  } catch (e) {
    stream.send("warn", { message: "fs.watch unavailable; polling fallback at 2s" });
    const poll = setInterval(emit, 2000);
    stream.onClose(() => clearInterval(poll));
  }

  const ping = pingInterval(stream, 15_000);
  stream.onClose(() => {
    clearInterval(ping);
    clearTimeout(pending);
    clearTimeout(closeTimer);
    try { watcher && watcher.close(); } catch {}
  });
}

/* GET /api/csrf — return the CSRF token (same as bearer; bearer-authed
   so unauthenticated callers can't fish for it). */
function getCsrf(req, res, ctx) {
  json(res, 200, { token: ctx.token });
}

module.exports = {
  "GET /api/csrf":             getCsrf,
  "GET /api/jobs":             listAll,
  "GET /api/jobs/stats":       jobsStats,
  "POST /api/jobs/deploy":     createDeploy,
  "POST /api/jobs/prune":      prune,
  "GET /api/jobs/:id":         getJob,
  "POST /api/jobs/:id/answer": postAnswer,
  "DELETE /api/jobs/:id":      deleteJob,
  "GET /api/jobs/:id/stream":  streamJob,
};
