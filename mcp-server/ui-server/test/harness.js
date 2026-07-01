#!/usr/bin/env node
/* test/harness.js — zero-dep test runner over node:assert (T33).
   Prints a PASS/FAIL table and exits non-zero on any failure.

   Hermetic by construction: it points DOKPILOT_JOBS_DIR at a throwaway dir and
   sets DOKPILOT_MOCK_FAST BEFORE requiring anything that pulls in lib/jobs.js, so
   the suite never touches the user's real ~/.claude jobs.

   Run:  node mcp-server/ui-server/test/harness.js
*/
"use strict";

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

// ── hermetic env (must be set before the suites require lib/jobs.js) ──────
const TMP_JOBS = fs.mkdtempSync(path.join(os.tmpdir(), "dokpilot-jobs-test-"));
process.env.DOKPILOT_JOBS_DIR = TMP_JOBS;
process.env.DOKPILOT_MOCK_FAST = "1";

// ── minimal registry ──────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Load the suites (register pattern — no circular require).
require("./deploy-path.e2e.js").register({ test, assert });
require("../lib/verify-deploy.test.js").register({ test, assert });

(async () => {
  const results = [];
  for (const t of tests) {
    const started = Date.now();
    try { await t.fn(); results.push({ name: t.name, ok: true, ms: Date.now() - started, err: null }); }
    catch (err) { results.push({ name: t.name, ok: false, ms: Date.now() - started, err }); }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("RESULT", 8) + pad("ms", 7) + "TEST");
  console.log("─".repeat(72));
  for (const r of results) {
    const mark = r.ok ? "✓ PASS" : "✗ FAIL";
    console.log(pad(mark, 8) + pad(r.ms, 7) + r.name);
    if (!r.ok) console.log("         " + (r.err && r.err.message ? r.err.message : String(r.err)));
  }
  const failed = results.filter((r) => !r.ok);
  console.log("─".repeat(72));
  console.log(`${results.length - failed.length} passed · ${failed.length} failed`);

  try { fs.rmSync(TMP_JOBS, { recursive: true, force: true }); } catch { /* noop */ }
  process.exit(failed.length ? 1 : 0);
})();
