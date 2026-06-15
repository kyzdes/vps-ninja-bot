/* lib/destroy-nonce.test.js — zero-dep unit test (node:assert).
   Run:  node mcp-server/ui-server/lib/destroy-nonce.test.js

   Covers (WS2 / T09):
     1. happy path: mint → verifyAndConsume → ok
     2. single-use: replay of the same nonce is rejected
     3. expired: a nonce past its expiry is rejected
     4. ttl-too-long: a nonce with an over-120s expiry is rejected
     5. tampered HMAC: flipping a byte is rejected
     6. target mismatch: wrong endpoint / resourceId / server is rejected
     7. worker-cannot-forge: verifying with a wrong/empty token fails
*/
"use strict";

const assert = require("node:assert");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

// Isolate the nonce dir: point HOME at a throwaway tmp dir BEFORE requiring the
// module (NONCE_DIR is resolved from os.homedir() at load time).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dokpilot-nonce-test-"));
process.env.HOME = TMP_HOME;
// os.homedir() can also read USERPROFILE on some platforms; keep them aligned.
process.env.USERPROFILE = TMP_HOME;

const nonceLib = require("./destroy-nonce");

let passed = 0;
function ok(label) { passed++; console.log("  ok  - " + label); }

const TOKEN  = "deadbeef".repeat(8); // looks like a 32-byte hex bearer
const TARGET = { endpoint: "application.delete", resourceId: "app_abc123", server: "main" };

try {
  // ── 1. happy path ──────────────────────────────────────────────────
  {
    const nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    assert.match(nonce, /^\d+\.[0-9a-f]+$/, "nonce shape <expiry>.<hex>");
    const r = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce });
    assert.strictEqual(r.ok, true, "happy verify should be ok; got " + JSON.stringify(r));
    ok("happy mint -> verify");
  }

  // ── 2. single-use replay rejected ──────────────────────────────────
  {
    const nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    const first = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce });
    assert.strictEqual(first.ok, true, "first consume ok");
    const second = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce });
    assert.strictEqual(second.ok, false, "replay must fail");
    assert.strictEqual(second.reason, "consumed-or-unknown", "replay reason; got " + second.reason);
    ok("single-use replay rejected");
  }

  // ── 3. expired (past expiry) rejected ──────────────────────────────
  {
    // Forge a syntactically valid, correctly-HMACed nonce but with an expiry
    // already in the past. This exercises the expiry check independent of the
    // descriptor (verify checks expiry BEFORE touching the file).
    const pastExpiry = Date.now() - 1000;
    const hmac = nonceLib._computeHmac(TOKEN, TARGET.endpoint, TARGET.resourceId, TARGET.server, pastExpiry);
    const nonce = `${pastExpiry}.${hmac}`;
    const r = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce });
    assert.strictEqual(r.ok, false, "expired must fail");
    assert.strictEqual(r.reason, "expired", "expired reason; got " + r.reason);
    ok("expired (past expiry) rejected");
  }

  // ── 4. ttl-too-long (>120s in the future) rejected ─────────────────
  {
    const farExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
    const hmac = nonceLib._computeHmac(TOKEN, TARGET.endpoint, TARGET.resourceId, TARGET.server, farExpiry);
    const nonce = `${farExpiry}.${hmac}`;
    const r = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce });
    assert.strictEqual(r.ok, false, "over-long ttl must fail");
    assert.strictEqual(r.reason, "ttl-too-long", "ttl reason; got " + r.reason);
    ok("expired/over-120s window rejected");
  }

  // ── 5. tampered HMAC rejected ──────────────────────────────────────
  {
    const nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    const dot = nonce.indexOf(".");
    const expiry = nonce.slice(0, dot);
    const hex = nonce.slice(dot + 1);
    // Flip the last hex nibble.
    const last = hex.slice(-1);
    const flipped = last === "f" ? "e" : "f";
    const tampered = `${expiry}.${hex.slice(0, -1)}${flipped}`;
    const r = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce: tampered });
    assert.strictEqual(r.ok, false, "tampered HMAC must fail");
    assert.strictEqual(r.reason, "bad-hmac", "tampered reason; got " + r.reason);
    ok("tampered HMAC rejected");
  }

  // ── 6. target mismatch rejected (endpoint / resourceId / server) ───
  {
    // Wrong endpoint
    let nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    let r = nonceLib.verifyAndConsume({ ...TARGET, endpoint: "project.remove", token: TOKEN, nonce });
    assert.strictEqual(r.ok, false, "wrong endpoint must fail");
    assert.strictEqual(r.reason, "bad-hmac", "endpoint mismatch fails HMAC; got " + r.reason);

    // Wrong resourceId
    nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    r = nonceLib.verifyAndConsume({ ...TARGET, resourceId: "app_OTHER", token: TOKEN, nonce });
    assert.strictEqual(r.ok, false, "wrong resourceId must fail");
    assert.strictEqual(r.reason, "bad-hmac", "resourceId mismatch fails HMAC; got " + r.reason);

    // Wrong server
    nonce = nonceLib.mint({ ...TARGET, token: TOKEN });
    r = nonceLib.verifyAndConsume({ ...TARGET, server: "edge", token: TOKEN, nonce });
    assert.strictEqual(r.ok, false, "wrong server must fail");
    assert.strictEqual(r.reason, "bad-hmac", "server mismatch fails HMAC; got " + r.reason);

    ok("target mismatch (endpoint/resourceId/server) rejected");
  }

  // ── 7. worker-cannot-forge: wrong/empty token fails ────────────────
  {
    // A prompt-injected worker has NO ui-server token. Even if it learns the
    // exact target + obtains a real nonce, it cannot produce a passing verify
    // because verify recomputes the HMAC with the REAL token. And if the worker
    // tries to MINT with a guessed/empty key, the resulting nonce won't verify
    // against the real token either.
    const nonce = nonceLib.mint({ ...TARGET, token: TOKEN });

    // (a) verify with a WRONG token → fail
    let r = nonceLib.verifyAndConsume({ ...TARGET, token: "00000000".repeat(8), nonce });
    assert.strictEqual(r.ok, false, "wrong token must fail");
    assert.strictEqual(r.reason, "bad-hmac", "wrong token fails HMAC; got " + r.reason);

    // (b) verify with an EMPTY token → fail fast (no-token)
    r = nonceLib.verifyAndConsume({ ...TARGET, token: "", nonce });
    assert.strictEqual(r.ok, false, "empty token must fail");
    assert.strictEqual(r.reason, "no-token", "empty token reason; got " + r.reason);

    // (c) worker mints with its OWN guessed key, server verifies with REAL key → fail
    const forged = nonceLib.mint({ ...TARGET, token: "attacker-guessed-key" });
    r = nonceLib.verifyAndConsume({ ...TARGET, token: TOKEN, nonce: forged });
    assert.strictEqual(r.ok, false, "worker-minted nonce must fail against real token");
    assert.strictEqual(r.reason, "bad-hmac", "forged-mint fails HMAC; got " + r.reason);

    ok("worker cannot forge (wrong/empty/guessed key rejected)");
  }

  // ── sanity: descriptor dir is 0700 ─────────────────────────────────
  {
    const st = fs.statSync(nonceLib.NONCE_DIR);
    const mode = st.mode & 0o777;
    assert.strictEqual(mode, 0o700, "NONCE_DIR should be 0700; got " + mode.toString(8));
    ok("NONCE_DIR is 0700");
  }

  console.log(`\nAll ${passed} destroy-nonce assertions passed.`);
  process.exit(0);
} catch (err) {
  console.error("\nFAIL:", err && err.message ? err.message : err);
  process.exit(1);
} finally {
  // Cleanup the throwaway home.
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* noop */ }
}
