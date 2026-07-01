/* lib/verify-deploy.test.js — WS3 (T17) matrix for server-side verification.
   Zero-dep (node:assert). Injects a stub deploymentAllFn so no shell-out.

   Runs two ways:
     - standalone:  node mcp-server/ui-server/lib/verify-deploy.test.js
     - harness:     required by test/harness.js via register({ test, assert })
*/
"use strict";

const { verifyDeployment } = require("./verify-deploy");

// A minimal job that has something to verify (job.result.app_id + job.server).
const mkJob = (over = {}) => ({ server: "main", result: { app_id: "app1", url: "https://x" }, ...over });
// Convenience: a stub fetcher that returns `val` and counts invocations.
const stub = (val) => { const s = (...a) => { s.calls++; return typeof val === "function" ? val(...a) : val; }; s.calls = 0; return s; };

function register({ test, assert }) {
  test("verify: [{status:done}] -> confirmed:true, latest_status done", async () => {
    const v = await verifyDeployment(mkJob(), async () => [{ status: "done", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.strictEqual(v.confirmed, true);
    assert.strictEqual(v.latest_status, "done");
    assert.ok(typeof v.checked_at === "string" && v.checked_at.length > 0, "checked_at set");
  });

  test("verify: [{status:error}] -> confirmed:false, latest_status error", async () => {
    const v = await verifyDeployment(mkJob(), async () => [{ status: "error", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(v.latest_status, "error");
  });

  test("verify: [{status:running}] -> confirmed:false, latest_status running", async () => {
    const v = await verifyDeployment(mkJob(), async () => [{ status: "running", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(v.latest_status, "running");
  });

  test("verify: [] empty array -> confirmed:false", async () => {
    const v = await verifyDeployment(mkJob(), async () => []);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(v.latest_status, null);
  });

  test("verify: {ok:true} (KI-022 empty-body non-array) -> confirmed:false, non-array reason", async () => {
    const v = await verifyDeployment(mkJob(), async () => ({ ok: true }));
    assert.strictEqual(v.confirmed, false);
    assert.ok(/non-array/.test(v.reason), "reason names non-array: " + v.reason);
  });

  test("verify: desc-sort picks the NEWEST (older done, newer running -> not confirmed)", async () => {
    const arr = [
      { deploymentId: "d1", status: "done",    createdAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:05:00Z" },
      { deploymentId: "d2", status: "running", createdAt: "2026-02-01T00:00:00Z" },
    ];
    const v = await verifyDeployment(mkJob(), async () => arr);
    assert.strictEqual(v.confirmed, false, "newest (running) wins over older done");
    assert.strictEqual(v.latest_status, "running");
  });

  test("verify: desc-sort picks the NEWEST (older running, newer done -> confirmed)", async () => {
    const arr = [
      { deploymentId: "d1", status: "running", createdAt: "2026-01-01T00:00:00Z" },
      { deploymentId: "d2", status: "done",    createdAt: "2026-02-01T00:00:00Z", finishedAt: "2026-02-01T00:04:00Z" },
    ];
    const v = await verifyDeployment(mkJob(), async () => arr);
    assert.strictEqual(v.confirmed, true, "newest (done) wins over older running");
    assert.strictEqual(v.latest_status, "done");
  });

  test("verify: transport __error -> ONE retry then confirmed:false (fn called twice)", async () => {
    const fn = stub({ __error: true, code: 124, timedOut: true });
    const v = await verifyDeployment(mkJob(), fn);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(fn.calls, 2, "called exactly twice (one retry)");
    assert.ok(/timed out|reach/.test(v.reason), "honest transport reason: " + v.reason);
  });

  test("verify: __error once then success -> retry succeeds, confirmed:true", async () => {
    let n = 0;
    const fn = (...a) => { n++; return n === 1 ? { __error: true, code: 1 } : [{ status: "done", createdAt: "2026-01-01T00:00:00Z" }]; };
    const v = await verifyDeployment(mkJob(), fn);
    assert.strictEqual(v.confirmed, true);
    assert.strictEqual(n, 2, "retried once and then succeeded");
  });

  test("verify: fetcher throws -> never throws, confirmed:false (one retry)", async () => {
    const fn = stub(() => { throw new Error("boom"); });
    const v = await verifyDeployment(mkJob(), fn);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(fn.calls, 2, "throw is retried once then given up");
  });

  test("verify: missing app_id -> confirmed:false (nothing to verify), fetcher NOT called", async () => {
    const fn = stub([{ status: "done" }]);
    const v = await verifyDeployment(mkJob({ result: {} }), fn);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(fn.calls, 0, "no app_id -> we never call Dokploy");
  });

  test("verify: missing server -> confirmed:false", async () => {
    const fn = stub([{ status: "done" }]);
    const v = await verifyDeployment(mkJob({ server: undefined }), fn);
    assert.strictEqual(v.confirmed, false);
    assert.strictEqual(fn.calls, 0, "no server -> we never call Dokploy");
  });

  test("verify: does not mutate the input job", async () => {
    const job = mkJob();
    const before = JSON.stringify(job);
    await verifyDeployment(job, async () => [{ status: "done", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.strictEqual(JSON.stringify(job), before, "job left untouched");
  });
}

module.exports = { register };

/* ── standalone runner (node lib/verify-deploy.test.js) ─────────────────── */
if (require.main === module) {
  const assert = require("node:assert");
  const tests = [];
  register({ test: (name, fn) => tests.push({ name, fn }), assert });
  (async () => {
    let failed = 0;
    for (const t of tests) {
      try { await t.fn(); console.log("  ok  - " + t.name); }
      catch (e) { failed++; console.log("  FAIL - " + t.name + "\n    " + ((e && e.message) || e)); }
    }
    console.log(`\n${tests.length - failed}/${tests.length} verify-deploy assertions passed.`);
    process.exit(failed ? 1 : 0);
  })();
}
