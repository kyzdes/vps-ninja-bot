/* lib/jobs.js — deploy job-queue helpers.
   Jobs live as JSON files under ~/.claude/skills/dokpilot/jobs/.
   The skill-side worker (`/dokpilot deploy --job <id>`) is the
   executor — it reads the file, transitions it through states,
   appends log lines, and persists answers. The HTTP server is the
   queue + UI proxy; it never deploys directly.

   File schema (versioned for forward compat):
   {
     schemaVersion: 2,
     id, created_at, updated_at,
     status: "pending|analyzing-repo|analyzing-stack|awaiting-answers|deploying|wait-dns|finalizing|done|done-unconfirmed|error",
       // done-unconfirmed (WS3/T18): the worker reported done, but the server's
       // independent verifyDeployment() could NOT confirm the latest Dokploy
       // deployment was terminal-success — an honest amber terminal state, not
       // green. Carries job.verification = { confirmed, latest_status, checked_at, reason }.
     repo, branch, server, domain,
     steps: [{id, label, status, duration_ms?}],
     questions: [{id, label, type, options?, hint?, required, answer?}],
     log: [{t, kind, text}],
     result: { app_id, url, ... } | null,
     error: string | null,
     worker: { pid, started_at, host } | null,
     manifest: <validated stack manifest> | null,          // v2 (WS1/D-019)
     manifest_validation: { ok, flags, errors } | null,     // v2
     cost_phase_a: number | null,                           // v2: Phase A cost (summed into cost_usd by Phase B)
   }

   v2 (two-phase worker, WS1 / D-019): a read-only Phase A (analyze-worker.js)
   distills the untrusted repo into `manifest`; Phase B (claude-worker.js) actuates
   infra from the manifest ONLY. Old v1 jobs (no manifest field) still load and
   resume — Phase B falls back to a degraded, repo-free path.

   Test/CI: JOBS_DIR honors DOKPILOT_JOBS_DIR for hermetic runs (T33).
*/
"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const os   = require("node:os");

// JOBS_DIR is overridable via DOKPILOT_JOBS_DIR so tests/CI can run hermetically
// against a throwaway dir instead of the user's real ~/.claude jobs (T33).
const JOBS_DIR = process.env.DOKPILOT_JOBS_DIR
  || path.join(os.homedir(), ".claude", "skills", "dokpilot", "jobs");

function ensureDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
}

function jobPath(id) {
  // Defensive: id must be `job_<hex>` shape so we can't be tricked into
  // writing outside JOBS_DIR via a path-traversal payload.
  if (!/^job_[a-z0-9_]+$/i.test(id)) {
    throw new Error("invalid job id: " + id);
  }
  return path.join(JOBS_DIR, id + ".json");
}

function newJobId() {
  // 12 hex chars; collision probability is negligible at this scale
  const rnd = require("node:crypto").randomBytes(6).toString("hex");
  return "job_" + rnd;
}

function readJob(id) {
  const p = jobPath(id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

/** Atomic write via tmp+rename so readers never see a half-written file. */
function writeJob(job) {
  ensureDir();
  job.updated_at = new Date().toISOString();
  const p = jobPath(job.id);
  const tmp = p + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  return job;
}

function listJobs() {
  ensureDir();
  return fs.readdirSync(JOBS_DIR)
    .filter((f) => /^job_[a-z0-9_]+\.json$/.test(f))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean);
}

function createJob({ repo, server, branch = "main", domain = null }) {
  ensureDir();
  const id = newJobId();
  const now = new Date().toISOString();
  const job = {
    schemaVersion: 2,
    id,
    created_at: now,
    updated_at: now,
    status: "pending",
    repo, branch, server, domain,
    steps: [
      { id: "analyze",   label: "Analyze repo",   status: "pending" },
      { id: "detect",    label: "Detect stack",   status: "pending" },
      { id: "questions", label: "Await answers",  status: "pending" },
      { id: "deploy",    label: "Deploying",      status: "pending" },
      { id: "dns",       label: "DNS + SSL",      status: "pending" },
      { id: "finalize",  label: "Finalize",       status: "pending" },
    ],
    questions: [],
    // Local-time HH:MM:SS matches the shell helpers' `date +%H:%M:%S` so
    // log entries from JS + bash share the same clock in the UI.
    log: [{ t: new Date().toTimeString().slice(0, 8), kind: "info", text: "Job created. Waiting for worker to pick up." }],
    result: null,
    error: null,
    worker: null,
    // v2 (WS1/D-019): populated by Phase A (analyze-worker.js). null until then.
    manifest: null,
    manifest_validation: null,
    cost_phase_a: null,
  };
  writeJob(job);
  return job;
}

function patchJob(id, mutator) {
  const job = readJob(id);
  if (!job) return null;
  mutator(job);
  return writeJob(job);
}

function answerQuestion(id, questionId, answer) {
  return patchJob(id, (job) => {
    const q = (job.questions || []).find((x) => x.id === questionId);
    if (!q) return;
    q.answer = answer;
    job.log = job.log || [];
    job.log.push({
      t: new Date().toTimeString().slice(0, 8),
      kind: "info",
      text: `User answered ${q.label}: ${typeof answer === "string" ? answer : JSON.stringify(answer)}`,
    });
    // If all required answers present, flip status so worker can resume
    const pendingReq = (job.questions || []).filter((q) => q.required && (q.answer == null || q.answer === ""));
    if (pendingReq.length === 0 && job.status === "awaiting-answers") {
      job.status = "deploying";
      const step = job.steps?.find((s) => s.id === "questions");
      if (step) step.status = "done";
      const next = job.steps?.find((s) => s.id === "deploy");
      if (next) next.status = "active";
    }
  });
}

/**
 * Decide which jobs the prune policy would remove from the jobs dir.
 *
 * Policy:
 *   keep_recent_done   keep at most this many of the most recent done jobs
 *   keep_recent_error  keep at most this many of the most recent error jobs
 *   older_than_days    anything older than this is eligible for deletion
 *                      regardless of the keep-recent counts (0 = ignore age)
 *
 * In-flight (non-terminal) jobs are NEVER deleted — a worker may be writing.
 *
 * Returns `{ delete, keep }` arrays of job IDs without touching disk; the
 * caller decides whether to execute (POST /api/jobs/prune `?dry_run=1`).
 */
function planPrune(policy) {
  const p = {
    keep_recent_done:  Number.isFinite(+policy?.keep_recent_done)  ? +policy.keep_recent_done  : 30,
    keep_recent_error: Number.isFinite(+policy?.keep_recent_error) ? +policy.keep_recent_error : 20,
    older_than_days:   Number.isFinite(+policy?.older_than_days)   ? +policy.older_than_days   : 0,
  };
  const all = listJobs().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  // done-unconfirmed (WS3) is a terminal state — it must be prunable, never
  // treated as an in-flight job the policy would keep forever.
  const TERMINAL = new Set(["done", "error", "done-unconfirmed"]);
  const cutoff = p.older_than_days > 0 ? Date.now() - p.older_than_days * 24 * 3600 * 1000 : -Infinity;

  let doneKept = 0, errorKept = 0;
  const del = [];
  const keep = [];
  for (const j of all) {
    if (!TERMINAL.has(j.status)) { keep.push(j.id); continue; } // in-flight — never delete
    const ageMs = j.created_at ? Date.now() - Date.parse(j.created_at) : 0;
    const tooOld = j.created_at && Date.parse(j.created_at) < cutoff;
    if (tooOld) { del.push(j.id); continue; }
    if (j.status === "done" || j.status === "done-unconfirmed") {
      if (doneKept < p.keep_recent_done) { keep.push(j.id); doneKept++; }
      else del.push(j.id);
    } else { // error
      if (errorKept < p.keep_recent_error) { keep.push(j.id); errorKept++; }
      else del.push(j.id);
    }
  }
  return { delete: del, keep, policy: p };
}

/**
 * Execute a plan: delete job.json + matching claude.log for each id.
 * Skips ids that don't exist (idempotent). Returns the count of files removed.
 */
function executePrune(ids) {
  let files = 0;
  for (const id of ids) {
    try {
      const p = jobPath(id);
      if (fs.existsSync(p)) { fs.unlinkSync(p); files++; }
      const log = p.replace(/\.json$/, ".claude.log");
      if (fs.existsSync(log)) { fs.unlinkSync(log); files++; }
    } catch (e) { /* keep going; the route summarises */ }
  }
  return files;
}

module.exports = {
  JOBS_DIR,
  jobPath,
  newJobId,
  readJob,
  writeJob,
  listJobs,
  createJob,
  patchJob,
  answerQuestion,
  planPrune,
  executePrune,
};
