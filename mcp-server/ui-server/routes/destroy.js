/* routes/destroy.js — server-side verify endpoint for the destroy nonce.

   POST /api/destroy/verify
     bearer + CSRF gated, consume-only.
     Body: { endpoint, resourceId, server, nonce }
     → verifyAndConsume({ ...body, token: ctx.token }) → { ok }

   This is the callback the destroy backstop in dokploy-api.sh curls (with the
   ui-server bearer + the minted nonce) to prove a delete was authorized by the
   ui-server itself, not by a prompt-injected worker. Because it is bearer+CSRF
   gated AND the bearer TOKEN is never threaded into any worker env, only the
   ui-server (and the dokployDestroy() flow it kicks off, which DOES thread the
   token for exactly one human-confirmed delete) can call it successfully.

   The endpoint NEVER mints — it only consumes. Minting happens server-side in
   exec.dokployDestroy() before the script is spawned.
*/
"use strict";

const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { verifyAndConsume } = require("../lib/destroy-nonce");

/** Read JSON body with a small cap (the verify body is tiny). */
function readBody(req, max = 16 * 1024) {
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

/* POST /api/destroy/verify — consume a destroy nonce, return { ok }. */
async function verifyDestroy(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body || typeof body !== "object") return json(res, 400, { error: "missing-body" });

  const { endpoint, resourceId, server, nonce } = body;
  if (!endpoint || !server || !nonce) {
    return json(res, 400, { error: "missing-fields", required: ["endpoint", "server", "nonce"] });
  }

  // The HMAC key is the per-launch bearer TOKEN (ctx.token). A caller that
  // reached here is already bearer-authed, but we still recompute + consume.
  const result = verifyAndConsume({
    endpoint,
    resourceId: resourceId == null ? "" : resourceId,
    server,
    token: ctx.token,
    nonce,
  });

  // Always 200 — the boolean is the answer; never leak the reason as an error
  // status (the script only inspects .ok). Reason aids local debugging only.
  return json(res, 200, { ok: result.ok === true, reason: result.reason });
}

module.exports = {
  "POST /api/destroy/verify": verifyDestroy,
};
