/* lib/destroy-nonce.js — server-minted, single-use, HMAC-signed destroy nonces.
   Zero-dep (node:crypto + node:fs + node:path + node:os only).

   WHY this exists (D-018 hardening, WS2):
   The destroy backstop used to be a bare env flag (DOKPILOT_CONFIRM_DESTROY=1).
   A prompt-injected deploy/analyze WORKER could in principle set that env on its
   own spawned children. A nonce closes that gap: only the ui-server can MINT a
   valid nonce, because minting requires the per-launch bearer TOKEN as the HMAC
   key — and that TOKEN is NEVER threaded into any worker's process env (it lives
   only in server.js memory; workers spawn with `env: process.env`, which has no
   token). So a worker has no key, cannot forge a nonce, and cannot call the
   bearer+CSRF-gated verify endpoint either. The deploy worker is structurally
   locked out of authorizing a destroy.

   Nonce wire format:  "<expiryEpochMs>.<hexHMAC>"
     hexHMAC = HMAC-SHA256(key = TOKEN,
                           msg = `${endpoint}\n${resourceId}\n${server}\n${expiryEpochMs}`)

   The HMAC binds the nonce to (endpoint, resourceId, server, expiry). A nonce
   minted to delete app A on server X cannot be replayed to delete app B, project
   C, or anything on server Y — the recomputed HMAC won't match.

   Single-use: mint() also writes a 0600 descriptor file under destroy-nonces/.
   verifyAndConsume() atomically rename()s that descriptor away before accepting,
   so a replay (same nonce twice) finds no descriptor and fails. The descriptor
   is a belt-and-suspenders replay guard ON TOP of the cryptographic check — the
   security does NOT rest on file mtime/owner trust; it rests on the HMAC.
*/
"use strict";

const crypto = require("node:crypto");
const fs     = require("node:fs");
const path   = require("node:path");
const os     = require("node:os");

// Mirror lib/jobs.js JOBS_DIR resolution: ~/.claude/skills/dokpilot/<sub>.
const STATE_DIR    = path.join(os.homedir(), ".claude", "skills", "dokpilot");
const NONCE_DIR    = path.join(STATE_DIR, "destroy-nonces");
const MAX_TTL_MS   = 120_000; // hard cap: a destroy nonce lives at most 120s

function ensureDir() {
  // 0700 — only the owning user may list/read nonce descriptors.
  fs.mkdirSync(NONCE_DIR, { recursive: true, mode: 0o700 });
}

/** Canonical message that the HMAC signs. Order + separators are fixed. */
function canonicalMsg(endpoint, resourceId, server, expiry) {
  return `${endpoint}\n${resourceId}\n${server}\n${expiry}`;
}

/** HMAC-SHA256(key=token, msg=canonical) → lowercase hex. */
function computeHmac(token, endpoint, resourceId, server, expiry) {
  return crypto
    .createHmac("sha256", String(token == null ? "" : token))
    .update(canonicalMsg(endpoint, String(resourceId == null ? "" : resourceId), server, expiry))
    .digest("hex");
}

/** Descriptor filename for a given nonce — derived (not the nonce itself) so a
 *  directory listing can't leak a usable nonce. */
function descriptorName(nonce) {
  return crypto.createHash("sha256").update(String(nonce)).digest("hex") + ".json";
}

/**
 * Mint a single-use destroy nonce bound to a specific target.
 *
 *   mint({ endpoint, resourceId, server, token, ttlMs? })
 *     → "<expiryEpochMs>.<hexHMAC>"
 *
 * Also writes a 0600 descriptor under destroy-nonces/ recording the target +
 * expiry so verifyAndConsume can atomically consume it once.
 */
function mint({ endpoint, resourceId, server, token, ttlMs }) {
  if (!endpoint || !server) {
    throw new Error("destroy-nonce.mint: endpoint and server are required");
  }
  if (!token) {
    // No token → no key → the resulting HMAC is unverifiable by the server.
    // Refuse rather than mint a uselessly-signed nonce.
    throw new Error("destroy-nonce.mint: token (HMAC key) is required");
  }
  const ttl = Math.min(Number(ttlMs) > 0 ? Number(ttlMs) : MAX_TTL_MS, MAX_TTL_MS);
  const expiry = Date.now() + ttl;
  const rid = String(resourceId == null ? "" : resourceId);
  const hmac = computeHmac(token, endpoint, rid, server, expiry);
  const nonce = `${expiry}.${hmac}`;

  ensureDir();
  const descPath = path.join(NONCE_DIR, descriptorName(nonce));
  const tmp = descPath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  const descriptor = {
    endpoint,
    resourceId: rid,
    server,
    expiry,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(descriptor), { mode: 0o600 });
  fs.renameSync(tmp, descPath);

  return nonce;
}

/**
 * Verify a nonce against a claimed target and consume it (single-use).
 *
 *   verifyAndConsume({ endpoint, resourceId, server, token, nonce })
 *     → { ok: boolean, reason?: string }
 *
 * Checks performed (ALL must pass):
 *   - nonce parses as "<expiry>.<hex>"
 *   - expiry is in the future AND within the MAX_TTL_MS window (no over-long TTL)
 *   - recomputed HMAC(token, endpoint, resourceId, server, expiry) timing-safe
 *     equals the nonce's HMAC  ← the real cryptographic gate
 *   - the single-use descriptor still exists, its recorded target matches, and
 *     we can atomically rename it away (replay → descriptor gone → fail)
 *
 * The HMAC check is the security boundary. The descriptor is an additional
 * replay guard, NOT a trust-by-file-metadata check.
 */
function verifyAndConsume({ endpoint, resourceId, server, token, nonce }) {
  if (!nonce || typeof nonce !== "string") return { ok: false, reason: "no-nonce" };
  if (!token) return { ok: false, reason: "no-token" };
  if (!endpoint || !server) return { ok: false, reason: "no-target" };

  const dot = nonce.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const expiryStr = nonce.slice(0, dot);
  const hmacGiven = nonce.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || !/^[0-9a-f]+$/i.test(hmacGiven)) {
    return { ok: false, reason: "malformed" };
  }

  const now = Date.now();
  if (expiry <= now) return { ok: false, reason: "expired" };
  // Reject over-long TTLs (a forged/edited expiry far in the future).
  if (expiry - now > MAX_TTL_MS) return { ok: false, reason: "ttl-too-long" };

  // ── Cryptographic check ──────────────────────────────────────────────
  const rid = String(resourceId == null ? "" : resourceId);
  const expected = computeHmac(token, endpoint, rid, server, expiry);
  const a = Buffer.from(hmacGiven, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-hmac" };
  }

  // ── Single-use consume: atomically rename the descriptor away ─────────
  const descPath = path.join(NONCE_DIR, descriptorName(nonce));
  let descriptor;
  try {
    descriptor = JSON.parse(fs.readFileSync(descPath, "utf8"));
  } catch {
    // No descriptor → already consumed (replay) or never minted here.
    return { ok: false, reason: "consumed-or-unknown" };
  }

  // Belt-and-suspenders: the descriptor's recorded target must match too.
  if (descriptor.endpoint !== endpoint ||
      String(descriptor.resourceId == null ? "" : descriptor.resourceId) !== rid ||
      descriptor.server !== server) {
    return { ok: false, reason: "target-mismatch" };
  }

  // Atomic consume — rename to a one-shot graveyard name, then unlink. The
  // rename is the actual single-use latch: a concurrent/replayed verify that
  // loses the race finds the descriptor gone and fails ENOENT.
  const consumedPath = descPath + ".consumed-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  try {
    fs.renameSync(descPath, consumedPath);
  } catch {
    return { ok: false, reason: "consumed-or-unknown" };
  }
  try { fs.unlinkSync(consumedPath); } catch { /* best-effort cleanup */ }

  return { ok: true };
}

module.exports = {
  STATE_DIR,
  NONCE_DIR,
  MAX_TTL_MS,
  mint,
  verifyAndConsume,
  // exported for tests / introspection only
  _computeHmac: computeHmac,
  _descriptorName: descriptorName,
};
