/* deploy-flow.js — shared live-deploy plumbing (v4.3 H4 / KYZ-238).
   Dedupes the job-stream mechanics that were copy-pasted across
   deploy.html (startLiveDeploy) and onboarding.html (launch + startInstall):
     - logLine(t,kind,text)            build a log-viewer row
     - subscribeJob(id, token, hooks)  EventSource + log-index diffing +
                                       terminal (done/error/not-found) routing
     - postAnswers(id, token, answers) POST each answer to /api/jobs/:id/answer

   Page-specific rendering (cursor, stepper, Q&A panel, done card) stays in the
   pages and is driven via the hooks. Plain script (window.DokFlow) — load
   after app.js, before the page's inline <script>. No app.js dependency
   (uses document.createElement so log rendering can't break on load order). */
(() => {
"use strict";

function logLine(t, kind, text) {
  const row = document.createElement("div");
  row.className = "log-line log-kind-" + (kind || "info");
  const ts = document.createElement("span");
  ts.className = "log-t"; ts.textContent = t || "·";
  const tx = document.createElement("span");
  tx.className = "log-text"; tx.textContent = text == null ? "" : String(text);
  row.append(ts, tx);
  return row;
}

/* Subscribe to a deploy/install job's SSE stream.
   hooks: {
     onJob(job, newLogLines)  // every update; newLogLines = log entries since last tick
     onDone(job), onError(job)// fired ONCE when status first goes terminal
     onUnconfirmed(job)       // WS3: fired ONCE on status 'done-unconfirmed'
                              // (server couldn't confirm the deploy). Falls back
                              // to onDone when a page doesn't supply it.
     onCost(job)              // fired once the worker's trailing cost_usd lands
     onNotFound(), onStreamError()
   }
   Returns { close() }. Tracks the log index internally so each page just
   renders the new lines however it likes.

   Terminal handling: onDone/onError fire as soon as the status goes terminal,
   but cost_usd is written a beat later (on the worker's process exit). So we
   keep the stream open after terminal; the server holds it open for that write
   then closes it — and we close our side on the server's close so EventSource
   doesn't auto-reconnect. */
function subscribeJob(jobId, token, hooks) {
  const h = hooks || {};
  let n = 0, stopped = false, terminalFired = false, costDelivered = false;
  const es = new EventSource(
    "/api/jobs/" + encodeURIComponent(jobId) + "/stream?t=" + encodeURIComponent(token)
  );
  // close(): consumer-initiated cleanup — stops the SSE AND the cost fallback.
  const close = () => { if (stopped) return; stopped = true; try { es.close(); } catch (e) {} };

  const deliverCost = (job) => {
    if (costDelivered || stopped) return;
    if (job && job.cost_usd != null) { costDelivered = true; if (h.onCost) h.onCost(job); }
  };

  // Fallback: cost_usd is written on the worker's process exit, which lags the
  // terminal status (the cost is finalized only when the worker's turn ends —
  // seen anywhere from ~10s to ~65s). If the SSE closed before it landed, fetch
  // the job until it appears. Bounded (≤13 tries / ~65s); independent of SSE.
  const pollCost = (attempt) => {
    if (costDelivered || stopped || attempt > 12) return;
    fetch("/api/jobs/" + encodeURIComponent(jobId), {
      credentials: "include",
      headers: { "Authorization": "Bearer " + token },
    })
      .then((r) => r.json())
      .then((d) => {
        if (costDelivered || stopped) return;
        if (d && d.job && d.job.cost_usd != null) deliverCost(d.job);
        else setTimeout(() => pollCost(attempt + 1), 5000);
      })
      .catch(() => { if (!costDelivered && !stopped) setTimeout(() => pollCost(attempt + 1), 5000); });
  };

  es.addEventListener("job", (e) => {
    let job; try { job = JSON.parse(e.data); } catch (err) { return; }
    const lines = job.log || [];
    const newLines = lines.slice(n);
    n = lines.length;
    if (h.onJob) h.onJob(job, newLines);
    const terminal = job.status === "done" || job.status === "error" || job.status === "done-unconfirmed";
    if (terminal && !terminalFired) {
      terminalFired = true;
      if (job.status === "error") { if (h.onError) h.onError(job); }
      else if (job.status === "done-unconfirmed") {
        // WS3: honest amber path. Fall back to onDone so pages that don't
        // handle it (e.g. onboarding) still show a terminal result.
        const fn = h.onUnconfirmed || h.onDone;
        if (fn) fn(job);
      }
      else { if (h.onDone) h.onDone(job); }
      // Kick the bounded fallback poll in case the SSE closes before cost lands.
      if (h.onCost) setTimeout(() => pollCost(0), 3000);
    }
    deliverCost(job); // fast path: cost already present on this event
  });
  es.addEventListener("not-found", () => { close(); if (h.onNotFound) h.onNotFound(); });
  es.addEventListener("error", () => {
    // After terminal the server intentionally closes the stream — close the ES
    // so it doesn't loop on reconnect, but DON'T stop the cost fallback poll.
    if (terminalFired) { try { es.close(); } catch (e) {} }
    else if (h.onStreamError) h.onStreamError();
  });
  return { close };
}

/* Post a set of answers. `answers` = [{ questionId, answer }]. */
async function postAnswers(jobId, token, answers) {
  for (const a of answers) {
    await fetch("/api/jobs/" + encodeURIComponent(jobId) + "/answer", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "X-CSRF": token },
      body: JSON.stringify({ questionId: a.questionId, answer: a.answer }),
    });
  }
}

window.DokFlow = { logLine, subscribeJob, postAnswers };
})();
