#!/usr/bin/env node
/* analyze-worker.js — PHASE A of the two-phase deploy worker (WS1 / D-019).

   The server spawns THIS file for a real deploy job. It performs the ONLY
   privileged read of the untrusted application repo and never actuates infra.

   Lifecycle:
     1. Read the job (JOB env id = argv[2]); status → "analyzing-repo".
     2. scan-repo.sh shallow-clones the repo into a throwaway dir and prints
        {clone_dir, branch, head_sha}. (It reads NO file contents.)
     3. Spawn a READ-ONLY claude (--permission-mode default, allow Read/Grep/Glob,
        MCP stripped, NO --add-dir of the repo, cwd = clone_dir) whose ONLY job is
        to emit a JSON stack manifest. buildAnalyzeArgs() builds the argv (pure,
        exported for tests).
     4. Parse the --output-format json envelope (.result = final text), extract the
        JSON manifest from it (fenced ```json block or first balanced {…}), then run
        validateManifest() — the single trust boundary. On failure → fail the job.
     5. Persist job.manifest + job.manifest_validation, write a 0600 manifest file,
        then spawn Phase B (claude-worker.js) with env MANIFEST_PATH and NO ui-server
        token. Phase B consumes ONLY the validated manifest — it never touches the repo.
     6. rm -rf the clone dir in a finally (guarded).
     7. Phase A's claude cost is recorded on the job (job.cost_phase_a) and ADDED to
        the final cost by Phase B — it never overwrites Phase B's cost.

   D-019: Phase A is read-only and structurally cannot mutate infra; the manifest is
   the only thing that crosses from "untrusted repo" into "trusted actuation".
*/
"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readJob, writeJob, jobPath } = require("./jobs");
const { validateManifest } = require("./manifest");
const { GUARD, PHASE_A_ADDENDUM } = require("./worker-guard");

const REPO_ROOT    = path.resolve(__dirname, "..", "..", "..");
const SCAN_REPO_SH = path.join(REPO_ROOT, "skills", "dokpilot", "scripts", "scan-repo.sh");
const PHASE_B_JS   = path.join(__dirname, "claude-worker.js");

// Phase A watchdog: a read-only analysis should be quick; cap it well under the
// deploy timeout so a hung analyze can't block the pipeline forever.
const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 10 * 60 * 1000);

/* ─── pure helpers (exported for tests) ───────────────────────────────── */

/**
 * Build the argv for the READ-ONLY Phase A claude. PURE — no I/O.
 * Invariants (asserted by test/deploy-path.e2e.js):
 *   - --permission-mode default   (NOT bypassPermissions)
 *   - Read/Grep/Glob allowlisted; Write/Edit/Bash/… disallowed
 *   - MCP fully stripped (--strict-mcp-config + empty --mcp-config)
 *   - NO --add-dir of the repo (cwd = clone_dir is the only granted path)
 */
function buildAnalyzeArgs({ prompt, systemPrompt }) {
  return [
    "--print", String(prompt == null ? "" : prompt),
    "--output-format", "json",
    "--permission-mode", "default",
    "--allowed-tools", "Read", "Grep", "Glob",
    "--disallowed-tools", "Write", "Edit", "NotebookEdit", "Bash", "KillShell", "WebFetch",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--append-system-prompt", String(systemPrompt == null ? "" : systemPrompt),
  ];
}

/** The read-only analysis system prompt: GUARD + PHASE_A addendum + manifest schema. */
function buildAnalyzeSystemPrompt() {
  const schema = [
    "",
    "OUTPUT CONTRACT — emit ONLY a single JSON object (no prose, no code fence needed,",
    "but a ```json fence is tolerated). The manifest describes what you OBSERVED:",
    "{",
    '  "stack": "node|nextjs|nuxt|angular|react|static|python|go|rust|ruby|java|php|docker|compose|unknown",',
    '  "framework": "<human string or null>",',
    '  "port": <int 1-65535 or null>,',
    '  "build": { "type": "nixpacks|dockerfile|compose|static|unknown" },',
    '  "has_dockerfile": <bool>,',
    '  "has_compose": <bool>,',
    '  "env_keys_needed": ["DATABASE_URL", "NODE_ENV"],   // NAMES ONLY — never a value',
    '  "db_needs": ["postgres|mysql|mariadb|mongo|redis"],',
    '  "build_cmd": "<string or null>",',
    '  "start_cmd": "<string or null>",',
    '  "notes": "<short free text>"',
    "}",
    "Never include secret VALUES. If a file contains a value (e.g. an .env), record only",
    "the KEY name. Report build/start commands VERBATIM as you observed them — do not run",
    "them; a later phase surfaces any risky command to a human for review.",
  ].join("\n");
  return [GUARD, PHASE_A_ADDENDUM, schema].join("\n");
}

/**
 * Extract a JSON manifest object from Phase A's final text.
 * Prefers a fenced ```json block; else the first balanced {…} that JSON.parses.
 * PURE — returns the parsed object or null. Exported for tests.
 */
function extractManifest(text) {
  if (typeof text !== "string" || !text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const obj = firstBalancedObject(fence[1]);
    if (obj) return obj;
  }
  return firstBalancedObject(text);
}

function firstBalancedObject(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    const end = matchBalanced(s, i);
    if (end === -1) continue;
    const candidate = s.slice(i, end + 1);
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o === "object" && !Array.isArray(o)) return o;
    } catch { /* not valid JSON here — keep scanning from the next brace */ }
  }
  return null;
}

function matchBalanced(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Parse the `claude --output-format json` envelope. PURE.
 * Returns { result, cost_usd, duration_ms, num_turns, is_error, subtype }.
 */
function parseAnalyzeEnvelope(stdout) {
  let env = null;
  try { env = JSON.parse(String(stdout).trim()); } catch { /* fall through */ }
  if (!env || typeof env !== "object") env = firstBalancedObject(String(stdout || "")) || {};
  const result = typeof env.result === "string" ? env.result
    : typeof env.text === "string" ? env.text : "";
  const cost = typeof env.total_cost_usd === "number" ? env.total_cost_usd
    : typeof env.cost_usd === "number" ? env.cost_usd : null;
  return {
    result,
    cost_usd: cost,
    duration_ms: typeof env.duration_ms === "number" ? env.duration_ms : null,
    num_turns: typeof env.num_turns === "number" ? env.num_turns : null,
    is_error: env.is_error === true,
    subtype: env.subtype || null,
  };
}

/** Copy env for a spawned worker, stripping any ui-server / destroy secrets (D-019). */
function workerEnv(extra) {
  const e = { ...process.env };
  delete e.UI_TOKEN;
  delete e.UI_VERIFY_URL;
  delete e.DOKPILOT_DESTROY_NONCE;
  return Object.assign(e, extra || {});
}

module.exports = {
  buildAnalyzeArgs,
  buildAnalyzeSystemPrompt,
  extractManifest,
  parseAnalyzeEnvelope,
  workerEnv,
};

/* ─── runtime (only when executed as a script) ────────────────────────── */

function ts() { return new Date().toTimeString().slice(0, 8); }
function appendLog(job, kind, text) {
  job.log = job.log || [];
  job.log.push({ t: ts(), kind, text });
}
function setStep(job, stepId, status) {
  const s = job.steps?.find((x) => x.id === stepId);
  if (s) s.status = status;
}

/** Spawn a process and capture stdout/stderr with a hard timeout. */
function runCapture(cmd, args, { cwd, env, timeoutMs, logStream } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", killed = false;
    const timer = timeoutMs ? setTimeout(() => { killed = true; try { child.kill("SIGTERM"); } catch {} }, timeoutMs) : null;
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); if (logStream) logStream.write(c); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); if (logStream) logStream.write(c); });
    child.on("error", (err) => { if (timer) clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr, error: err, killed }); });
    child.on("exit", (code, signal) => { if (timer) clearTimeout(timer); resolve({ code, signal, stdout, stderr, error: null, killed }); });
  });
}

function failJob(id, message, kind) {
  const job = readJob(id);
  if (!job) return;
  job.status = "error";
  job.error = message;
  appendLog(job, "error", (kind || "Phase A failed") + ": " + message);
  writeJob(job);
}

async function main() {
  const id = process.argv[2];
  if (!id) { console.error("usage: analyze-worker.js <job-id>"); process.exit(2); }

  const job0 = readJob(id);
  if (!job0) { console.error("job not found:", id); process.exit(2); }

  const JOB_FILE  = jobPath(id);
  const CLAUDE_LOG = JOB_FILE.replace(/\.json$/, ".claude.log");
  const MANIFEST_FILE = JOB_FILE.replace(/\.json$/, ".manifest.json");
  const logStream = fs.createWriteStream(CLAUDE_LOG, { flags: "a" });
  logStream.write(`\n--- phase A (analyze) start ${new Date().toISOString()} pid=${process.pid} ---\n`);

  // Mark Phase A running.
  job0.worker = { pid: process.pid, started_at: new Date().toISOString(), host: "analyze" };
  job0.status = "analyzing-repo";
  setStep(job0, "analyze", "active");
  appendLog(job0, "info", `Analyzing ${job0.repo} (branch: ${job0.branch}) — read-only clone…`);
  writeJob(job0);

  let cloneDir = null;
  try {
    // 1. Shallow clone via scan-repo.sh (URL passed as argv — no shell injection).
    const repoUrl = /^https?:\/\/|^git@/.test(job0.repo) ? job0.repo : "https://" + job0.repo;
    const scan = await runCapture("bash", [SCAN_REPO_SH, repoUrl, job0.branch || ""], {
      env: workerEnv(), timeoutMs: 5 * 60 * 1000, logStream,
    });
    let scanJson = null;
    try { scanJson = JSON.parse((scan.stdout || "").trim()); } catch {}
    if (!scanJson || !scanJson.clone_dir) {
      failJob(id, "could not clone the repo for analysis (check URL / branch / access)", "Clone failed");
      return;
    }
    cloneDir = scanJson.clone_dir;
    appendLog3(id, "ok", `Cloned ${job0.repo}@${scanJson.branch || job0.branch} (${(scanJson.head_sha || "").slice(0, 7)})`);

    // 2. Read-only Phase A claude → JSON manifest.
    const args = buildAnalyzeArgs({
      prompt: "Analyze this repository and output ONLY the JSON stack manifest defined in your instructions. No prose.",
      systemPrompt: buildAnalyzeSystemPrompt(),
    });
    logStream.write(`--- phase A claude spawn (cwd=${cloneDir}) ---\n`);
    const run = await runCapture("claude", args, {
      cwd: cloneDir, env: workerEnv(), timeoutMs: ANALYZE_TIMEOUT_MS, logStream,
    });
    if (run.error) { failJob(id, "failed to spawn claude for analysis: " + run.error.message, "Analyze spawn"); return; }

    const envlp = parseAnalyzeEnvelope(run.stdout);

    // 3. Record Phase A cost immediately (so it survives even if Phase B never spawns).
    {
      const j = readJob(id);
      if (j) {
        if (envlp.cost_usd != null) {
          j.cost_phase_a = envlp.cost_usd;
          j.cost_usd = envlp.cost_usd; // Phase B sums its own cost onto this later.
          j.run_stats_phase_a = { duration_ms: envlp.duration_ms, num_turns: envlp.num_turns };
        }
        writeJob(j);
      }
    }

    if (run.killed) { failJob(id, `analysis timed out after ${Math.round(ANALYZE_TIMEOUT_MS / 1000)}s`, "Analyze timeout"); return; }

    // 4. Extract + validate the manifest (the trust boundary).
    const rawManifest = extractManifest(envlp.result);
    if (!rawManifest) {
      failJob(id, "Phase A did not emit a parseable JSON manifest (see claude.log)", "Analyze");
      return;
    }
    const v = validateManifest(rawManifest);
    {
      const j = readJob(id);
      if (j) {
        j.manifest = v.manifest;
        j.manifest_validation = { ok: v.ok, flags: v.flags, errors: v.errors };
        writeJob(j);
      }
    }
    if (!v.ok) {
      failJob(id, "manifest failed validation: " + v.errors.join("; "), "Trust-boundary reject");
      return;
    }

    // Surface the outcome + any flags on the dashboard log.
    {
      const j = readJob(id);
      appendLog(j, "ok", `Manifest: stack=${v.manifest.stack} port=${v.manifest.port ?? "n/a"} build=${v.manifest.build_type} db=[${v.manifest.db_needs.join(",")}]`);
      for (const f of v.flags) appendLog(j, "warn", f);
      // Hand off: analyze done, detect (plan) becomes active; Phase B drives the rest.
      setStep(j, "analyze", "done");
      setStep(j, "detect", "active");
      j.status = "analyzing-stack";
      writeJob(j);
    }

    // 5. Persist a 0600 manifest file + spawn Phase B (claude-worker.js) with NO token.
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(v.manifest, null, 2), { mode: 0o600 });
    logStream.write(`--- phase A ok — spawning phase B (deploy) with MANIFEST_PATH=${MANIFEST_FILE} ---\n`);
    const child = spawn(process.execPath, [PHASE_B_JS, id], {
      detached: true,
      stdio: "ignore",
      env: workerEnv({ MANIFEST_PATH: MANIFEST_FILE }),
    });
    child.unref();
  } catch (err) {
    logStream.write(`--- phase A error: ${err && err.stack ? err.stack : err} ---\n`);
    failJob(id, String(err && err.message ? err.message : err), "Phase A crashed");
  } finally {
    // 6. Always remove the throwaway clone — Phase B works from the manifest only.
    if (cloneDir) {
      try {
        if (/dokpilot-clone\./.test(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });
      } catch (e) { logStream.write(`--- clone cleanup failed: ${e.message} ---\n`); }
    }
    logStream.write(`--- phase A end ${new Date().toISOString()} ---\n`);
    logStream.end();
  }
}

// appendLog3: append a log line to the freshest on-disk job (avoids clobbering
// concurrent writes by re-reading before appending).
function appendLog3(id, kind, text) {
  const j = readJob(id);
  if (!j) return;
  appendLog(j, kind, text);
  writeJob(j);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[analyze-worker] fatal:", err);
    try { failJob(process.argv[2], String(err && err.message ? err.message : err), "Phase A fatal"); } catch {}
    process.exit(1);
  });
}
