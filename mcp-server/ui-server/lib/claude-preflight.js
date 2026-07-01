/* lib/claude-preflight.js — is the `claude` CLI usable before we start a deploy?
   Zero-dep (node:child_process only). WS10 / T35.

   A Dokpilot deploy spawns a headless `claude` (Phase A analyze → Phase B deploy).
   External users may not have Claude Code installed or signed in. Instead of a
   half-started job that dead-ends at a timeout, the deploy is GATED on a cheap
   preflight: `claude --version` (free, catches the #1 failure — not installed /
   not on PATH). We FAIL OPEN on anything softer than "clearly missing": a real
   auth wall is surfaced at deploy time via the claude.log tail in job.error
   (DEP-3), rather than paying a usage round-trip here on every deploy.
*/
"use strict";

const { execFile } = require("node:child_process");

let _cache = null;            // { at, result }
const TTL_MS = 30_000;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; resolve(r); };
    try {
      const child = execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        finish({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
      child.on("error", (err) => finish({ err, stdout: "", stderr: "" }));
    } catch (err) {
      finish({ err, stdout: "", stderr: "" });
    }
  });
}

/**
 * preflightClaude({force?}) -> { ok, state, version, hint }
 *   state: 'ok' | 'missing' | 'error'
 * Memoized ~30s so /api/health and every deploy don't each shell out.
 */
async function preflightClaude(opts = {}) {
  const now = Date.now();
  if (!opts.force && _cache && now - _cache.at < TTL_MS) return _cache.result;

  const v = await run("claude", ["--version"], 5000);
  let result;
  if (v.err) {
    const missing = v.err.code === "ENOENT" || /not found|ENOENT/i.test(v.err.message || "");
    result = missing
      ? { ok: false, state: "missing", version: null,
          hint: "The `claude` CLI is not installed or not on PATH. Dokpilot's deploy runs a headless `claude` — install Claude Code and sign in, then retry." }
      : { ok: false, state: "error", version: null,
          hint: ("`claude --version` failed: " + (v.err.message || "unknown")).slice(0, 200) };
  } else {
    const version = ((v.stdout || "").trim().split("\n")[0] || null);
    // --version succeeded -> the CLI is present. Auth is checked lazily at deploy
    // time (fail-open): the worker surfaces claude.log's tail in job.error (DEP-3).
    result = { ok: true, state: "ok", version, hint: null };
  }
  _cache = { at: now, result };
  return result;
}

module.exports = { preflightClaude };
