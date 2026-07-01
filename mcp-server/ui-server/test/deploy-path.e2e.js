/* test/deploy-path.e2e.js — WS10 T34 (lifecycle part) + arg-builder / extractor units.
   Registered into test/harness.js via register({ test, assert }).

   Coverage:
     1. E2E (mock): a deploy job walks its full lifecycle to `done` under the mock
        worker in a hermetic JOBS_DIR with DOKPILOT_MOCK_FAST — assert all steps done,
        result populated, cost_usd present, and NO premature `done`.
     2. UNIT: buildAnalyzeArgs() — Phase A is read-only (default perm mode + Read/Grep/Glob;
        no bypassPermissions, no --add-dir of the repo).
     3. UNIT: buildDeployArgs() — Phase B actuates (bypassPermissions + --add-dir <SKILL_DIR>,
        never --add-dir <REPO_ROOT>; AskUserQuestion disallowed).
     4. UNIT: extractManifest() — pulls the JSON manifest out of a fenced ```json block and
        out of free prose (first balanced object).
     5. UNIT: parseAnalyzeEnvelope() — reads .result + cost off the --output-format json envelope.
     6. BACK-COMPAT: a v1 "deploying" job with no manifest field resumes under v2 (degraded)
        without crashing.
     7. UNIT: resolveManifest() precedence (MANIFEST_PATH → job.manifest → degraded).

   TODO (WS3): verify-done assertions (reachability / cert / DNS correctness) belong to the
   verify-done work — this file only proves the lifecycle + trust-boundary arg wiring.
*/
"use strict";

const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const LIB = path.join(__dirname, "..", "lib");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function register({ test, assert }) {
  /* ── 1. E2E lifecycle via the mock worker ─────────────────────────────── */
  test("e2e(mock): deploy job reaches done with all steps + result + cost, no premature done", async () => {
    const jobs = require(path.join(LIB, "jobs.js"));
    const job = jobs.createJob({ repo: "github.com/acme/widget", server: "mock-server", branch: "main", domain: null });

    // Sanity: v2 seed shape.
    assert.strictEqual(job.schemaVersion, 2, "new jobs are schemaVersion 2");
    assert.strictEqual(job.manifest, null, "manifest seeded null");
    assert.ok(job.steps.some((s) => s.id === "analyze"), "analyze step present");

    const workerPath = path.join(LIB, "mock-worker.js");
    const child = spawn(process.execPath, [workerPath, job.id], { stdio: "ignore", env: process.env });

    const statusesSeen = [];
    let doneSnapshot = null;
    const deadline = Date.now() + 20_000;
    try {
      while (Date.now() < deadline) {
        const j = jobs.readJob(job.id);
        if (j) {
          if (statusesSeen[statusesSeen.length - 1] !== j.status) statusesSeen.push(j.status);
          // Answer required questions the instant the worker asks.
          if (j.status === "awaiting-answers") {
            for (const q of j.questions || []) {
              if (q.required && (q.answer == null || q.answer === "")) {
                const ans = q.type === "select" ? (q.options && q.options[0]) : (q.placeholder || "https://example.com");
                jobs.answerQuestion(job.id, q.id, ans);
              }
            }
          }
          if (j.status === "done" || j.status === "error") { doneSnapshot = j; break; }
        }
        await sleep(25);
      }
    } finally {
      try { child.kill("SIGTERM"); } catch { /* noop */ }
    }

    assert.ok(doneSnapshot, "job reached a terminal state before the deadline");
    assert.strictEqual(doneSnapshot.status, "done", "terminal status is done (not error); saw " + JSON.stringify(statusesSeen));
    // No premature done: we observed intermediate progression first.
    assert.ok(statusesSeen.includes("deploying"), "progressed through deploying before done: " + JSON.stringify(statusesSeen));
    assert.ok(statusesSeen.indexOf("done") === statusesSeen.length - 1, "done is the LAST status seen (never premature)");
    // All steps done.
    assert.ok(doneSnapshot.steps.every((s) => s.status === "done"), "every step is done: " + JSON.stringify(doneSnapshot.steps.map((s) => [s.id, s.status])));
    // Result + cost populated.
    assert.ok(doneSnapshot.result && doneSnapshot.result.url && doneSnapshot.result.app_id, "result populated (url + app_id)");
    assert.strictEqual(typeof doneSnapshot.cost_usd, "number", "cost_usd present and numeric");
  });

  /* ── 2. Phase A arg-builder ─────────────────────────────────────────────── */
  test("unit: buildAnalyzeArgs is read-only (default perm mode, Read/Grep/Glob, no bypass, no --add-dir)", () => {
    const { buildAnalyzeArgs } = require(path.join(LIB, "analyze-worker.js"));
    const args = buildAnalyzeArgs({ prompt: "analyze", systemPrompt: "SYS" });

    const pm = args.indexOf("--permission-mode");
    assert.ok(pm !== -1 && args[pm + 1] === "default", "--permission-mode default");
    assert.ok(!args.includes("bypassPermissions"), "must NOT contain bypassPermissions");

    const at = args.indexOf("--allowed-tools");
    assert.ok(at !== -1, "--allowed-tools present");
    assert.ok(args.includes("Read") && args.includes("Grep") && args.includes("Glob"), "Read/Grep/Glob allowlisted");

    const dt = args.indexOf("--disallowed-tools");
    assert.ok(dt !== -1 && args.slice(dt + 1).includes("Write") && args.slice(dt + 1).includes("Bash"), "Write/Bash disallowed");

    assert.ok(!args.includes("--add-dir"), "Phase A grants NO --add-dir (no repo root, cwd=clone only)");
    assert.ok(args.includes("--strict-mcp-config"), "MCP stripped: --strict-mcp-config");
    const mc = args.indexOf("--mcp-config");
    assert.ok(mc !== -1 && args[mc + 1] === '{"mcpServers":{}}', "empty --mcp-config");
    assert.ok(args.includes("--output-format") && args[args.indexOf("--output-format") + 1] === "json", "--output-format json");
  });

  /* ── 3. Phase B arg-builder ─────────────────────────────────────────────── */
  test("unit: buildDeployArgs actuates (bypassPermissions + --add-dir SKILL_DIR, not REPO_ROOT)", () => {
    const { buildDeployArgs } = require(path.join(LIB, "claude-worker.js"));
    const repoRoot   = "/repo";
    const skillDir   = "/repo/skills/dokpilot";
    const helpersDir = "/repo/mcp-server/ui-server/lib/worker-helpers";
    const args = buildDeployArgs({ systemPrompt: "SYS", skillDir, helpersDir });

    const pm = args.indexOf("--permission-mode");
    assert.ok(pm !== -1 && args[pm + 1] === "bypassPermissions", "--permission-mode bypassPermissions");

    const addDirs = args.reduce((acc, v, i) => (v === "--add-dir" ? acc.concat([args[i + 1]]) : acc), []);
    assert.ok(addDirs.includes(skillDir), "--add-dir <SKILL_DIR> present");
    assert.ok(addDirs.includes(helpersDir), "--add-dir <HELPERS_DIR> present");
    assert.ok(!addDirs.includes(repoRoot), "must NOT --add-dir the repo root");

    const dt = args.indexOf("--disallowedTools");
    assert.ok(dt !== -1 && args[dt + 1] === "AskUserQuestion", "AskUserQuestion disallowed");
  });

  /* ── 4. manifest extraction ─────────────────────────────────────────────── */
  test("unit: extractManifest pulls a fenced ```json manifest", () => {
    const { extractManifest } = require(path.join(LIB, "analyze-worker.js"));
    const result = 'Analysis complete.\n\n```json\n{\n  "stack": "nextjs",\n  "port": 3000,\n  "env_keys_needed": ["DATABASE_URL"]\n}\n```\n\nDone.';
    const m = extractManifest(result);
    assert.ok(m && typeof m === "object", "returns an object");
    assert.strictEqual(m.stack, "nextjs", "stack parsed");
    assert.strictEqual(m.port, 3000, "port parsed");
    assert.deepStrictEqual(m.env_keys_needed, ["DATABASE_URL"], "env keys parsed");
  });

  test("unit: extractManifest returns the first balanced object from free prose", () => {
    const { extractManifest } = require(path.join(LIB, "analyze-worker.js"));
    const result = 'here is a nested example {"stack":"go","build":{"type":"nixpacks"}} trailing text';
    const m = extractManifest(result);
    assert.strictEqual(m.stack, "go", "first balanced object parsed (nested braces handled)");
    assert.strictEqual(m.build.type, "nixpacks", "nested object preserved");
    assert.strictEqual(extractManifest("no json here at all"), null, "no object -> null");
  });

  /* ── 5. envelope parsing ────────────────────────────────────────────────── */
  test("unit: parseAnalyzeEnvelope reads .result + cost off the json envelope", () => {
    const { parseAnalyzeEnvelope } = require(path.join(LIB, "analyze-worker.js"));
    const envelope = JSON.stringify({ type: "result", subtype: "success", result: "```json\n{\"stack\":\"node\"}\n```", total_cost_usd: 0.0345, duration_ms: 1234, num_turns: 3, is_error: false });
    const e = parseAnalyzeEnvelope(envelope);
    assert.ok(e.result.includes('"stack":"node"'), ".result extracted");
    assert.strictEqual(e.cost_usd, 0.0345, "cost extracted");
    assert.strictEqual(e.num_turns, 3, "num_turns extracted");
    assert.strictEqual(parseAnalyzeEnvelope("garbage").cost_usd, null, "garbage -> null cost, no throw");
  });

  /* ── 6. back-compat: v1 job (no manifest) resumes under v2 ──────────────── */
  test("back-compat: v1 'deploying' job with no manifest resumes under v2 (degraded, no crash)", () => {
    const cw = require(path.join(LIB, "claude-worker.js"));
    const v1job = { id: "job_deadbeef01", schemaVersion: 1, status: "deploying", repo: "github.com/a/b", branch: "main", server: "s", steps: [], log: [] };
    const r = cw.resolveManifest({ env: {}, job: v1job });
    assert.strictEqual(r.manifest, null, "no manifest -> null");
    assert.strictEqual(r.source, "degraded", "degraded source");
    const sp = cw.buildDeploySystemPrompt({ manifest: null, source: "degraded", job: v1job });
    assert.ok(typeof sp === "string" && sp.length > 0, "prompt builds with a null manifest (no throw)");
    assert.ok(/DEGRADED RESUME/.test(sp), "degraded note surfaced in the prompt");
    assert.ok(/SECURITY/.test(sp), "GUARD prepended even in degraded mode");
  });

  /* ── 7. resolveManifest precedence ──────────────────────────────────────── */
  test("unit: resolveManifest precedence (MANIFEST_PATH > job.manifest > degraded)", () => {
    const cw = require(path.join(LIB, "claude-worker.js"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dokpilot-manifest-"));
    try {
      const mp = path.join(dir, "m.json");
      fs.writeFileSync(mp, JSON.stringify({ stack: "python", port: 8000 }));
      const job = { manifest: { stack: "node" } };
      // MANIFEST_PATH wins over job.manifest
      let r = cw.resolveManifest({ env: { MANIFEST_PATH: mp }, job });
      assert.strictEqual(r.source, "manifest-path", "MANIFEST_PATH takes precedence");
      assert.strictEqual(r.manifest.stack, "python", "manifest loaded from file");
      // Missing file -> falls back to job.manifest
      r = cw.resolveManifest({ env: { MANIFEST_PATH: path.join(dir, "nope.json") }, job });
      assert.strictEqual(r.source, "job.manifest", "falls back to job.manifest when file missing");
      assert.strictEqual(r.manifest.stack, "node", "job.manifest used");
      // Nothing -> degraded
      r = cw.resolveManifest({ env: {}, job: {} });
      assert.strictEqual(r.source, "degraded", "no source -> degraded");
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
}

module.exports = { register };
