/* lib/verify-deploy.js — WS3 (T17): server-side deploy verification.

   The deploy WORKER reports `done`. The SERVER independently CONFIRMS it by
   re-fetching Dokploy's `deployment.all` for the app and requiring the LATEST
   deployment to be terminal-success (`status === "done"`). If it can't be
   confirmed we return confirmed:false so the finalizer can mark the job
   `done-unconfirmed` (honest amber) instead of a celebratory green.

   `verifyDeployment(job, deploymentAllFn)` is PURE w.r.t. its inputs:
     - It never mutates `job` and never throws.
     - `deploymentAllFn(server, appId) -> array | {__error} | anything` defaults
       to a real GET deployment.all via lib/exec, but is INJECTABLE for tests.

   Trust/robustness rules (see task WS3):
     - Missing app_id / server            -> confirmed:false (nothing to verify).
     - Non-array response (KI-022: exec's {ok:true} on an EMPTY success body, or
       any other non-array)               -> confirmed:false, "non-array response".
     - Empty array []                     -> confirmed:false (no deployments).
     - Sort by finishedAt/createdAt DESC   -> take the LATEST (API guarantees no
                                             ordering) and inspect its status.
     - latest.status === "done"           -> confirmed:true.
     - error / running / anything else     -> confirmed:false, honest reason.
     - transport {__error} or a throw     -> ONE retry, then confirmed:false.
     - short per-call timeout so a healthy deploy never hangs past `done`.
*/
"use strict";

// Cap each deployment.all call so verification can't stall the finalizer far
// past the worker's `done` (one retry => worst case ~2x this).
const VERIFY_TIMEOUT_MS = Number(process.env.DOKPILOT_VERIFY_TIMEOUT_MS || 8000);

const iso = () => new Date().toISOString();

/** Default (real) fetcher: GET deployment.all?applicationId=<id> via lib/exec.
 *  Lazy-required so injected-stub tests never pull in the shell layer. */
async function realDeploymentAll(server, appId) {
  const { dokploy } = require("./exec");
  return dokploy(
    server,
    "GET",
    "deployment.all?applicationId=" + encodeURIComponent(appId),
    null,
    { timeout: VERIFY_TIMEOUT_MS }
  );
}

/** Pick the newest deployment. The API documents NO ordering, so sort DESC by
 *  finishedAt (preferred) or createdAt; unparseable timestamps sort last. */
function pickLatest(arr) {
  const ts = (d) => {
    const v = d && (d.finishedAt || d.createdAt);
    const n = v ? Date.parse(v) : NaN;
    return Number.isFinite(n) ? n : -Infinity;
  };
  return arr.slice().sort((a, b) => ts(b) - ts(a))[0];
}

/** One attempt: returns { ok:true, res } or { ok:false, err }. Never throws. */
async function fetchOnce(fn, server, appId) {
  try {
    const r = await fn(server, appId);
    if (r && r.__error) return { ok: false, err: r };
    return { ok: true, res: r };
  } catch (e) {
    return { ok: false, err: { __error: true, thrown: true, message: String((e && e.message) || e) } };
  }
}

/**
 * @param {object} job                 the deploy job (reads job.result.app_id + job.server)
 * @param {function} [deploymentAllFn] injectable fetcher (server, appId) -> deployments
 * @returns {Promise<{confirmed:boolean, latest_status:string|null, checked_at:string, reason:string}>}
 */
async function verifyDeployment(job, deploymentAllFn = realDeploymentAll) {
  try {
    const appId  = job && job.result && job.result.app_id;
    const server = job && job.server;
    if (!appId) {
      return { confirmed: false, latest_status: null, checked_at: iso(), reason: "no app_id on job.result — nothing to verify" };
    }
    if (!server) {
      return { confirmed: false, latest_status: null, checked_at: iso(), reason: "no server on job — cannot query Dokploy" };
    }

    // Transport: try once, retry ONCE on {__error}/throw, then give up honestly.
    let attempt = await fetchOnce(deploymentAllFn, server, appId);
    if (!attempt.ok) attempt = await fetchOnce(deploymentAllFn, server, appId);
    if (!attempt.ok) {
      const timedOut = attempt.err && attempt.err.timedOut;
      return { confirmed: false, latest_status: null, checked_at: iso(),
        reason: "could not reach Dokploy deployment.all" + (timedOut ? " (timed out)" : "") };
    }

    const res = attempt.res;
    // KI-022: dokploy() returns { ok:true } on an EMPTY success body — a non-array
    // we must NOT read as "confirmed". Any non-array is unverifiable.
    if (!Array.isArray(res)) {
      return { confirmed: false, latest_status: null, checked_at: iso(), reason: "non-array response from deployment.all (KI-022 empty body?)" };
    }
    if (res.length === 0) {
      return { confirmed: false, latest_status: null, checked_at: iso(), reason: "no deployments found for this app" };
    }

    const latest = pickLatest(res);
    const status = latest && latest.status != null ? String(latest.status) : null;
    if (status === "done") {
      return { confirmed: true, latest_status: "done", checked_at: iso(), reason: "latest deployment is done" };
    }
    return { confirmed: false, latest_status: status, checked_at: iso(),
      reason: "latest deployment status is " + (status || "unknown") + " (not done)" };
  } catch (e) {
    // Belt-and-suspenders: verifyDeployment must NEVER throw.
    return { confirmed: false, latest_status: null, checked_at: iso(), reason: "verify crashed: " + String((e && e.message) || e) };
  }
}

module.exports = { verifyDeployment, pickLatest, realDeploymentAll, VERIFY_TIMEOUT_MS };
