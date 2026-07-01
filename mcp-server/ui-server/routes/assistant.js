"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const { json } = require("../lib/http");
const { openStream, pingInterval } = require("../lib/sse");
const csrf = require("../lib/csrf");
const { REPO_ROOT } = require("../lib/exec");

/**
 * /api/assistant — Claude console.
 *
 *   POST /api/assistant
 *     Body: { prompt, context? }
 *     Spawns the local `claude` CLI in non-interactive mode with
 *     stream-json output. Stashes the child handle keyed by a
 *     generated session id. Returns { session_id }.
 *
 *   GET /api/assistant/:session/stream
 *     SSE. Forwards filtered events from the child's stream-json:
 *       - assistant text chunks   → event: text
 *       - tool_use entries        → event: tool
 *       - tool_result entries     → event: tool_result
 *       - permission denials      → event: permission
 *       - result (final stats)    → event: done
 *     System/hook events are filtered out (not interesting to UI).
 *
 * The dashboard's running ui-server passes its bearer token in to the
 * claude subprocess so the assistant can call dokpilot-skill routes
 * (M1+ endpoints) via the same authenticated channel. This is a stub
 * — the real implementation would wire the token into a transient
 * environment variable that the spawned Claude can read.
 */

const sessions = new Map(); // session_id → { child, stream, buffer, createdAt }

function newSessionId() {
  return "ses_" + crypto.randomBytes(6).toString("hex");
}

/** Read JSON body (64KB cap). */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (c) => {
      length += c.length;
      if (length > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; }
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

/** Spawn the claude CLI with stream-json. */
function spawnClaude(prompt, { contextHint } = {}) {
  // Note: we deliberately do NOT pass --bare. That flag skips Keychain
  // reads, hooks, and skill discovery — but the user authenticates via
  // the OAuth flow Claude Code uses, which lives behind the Keychain
  // backend. Keeping the hooks running adds some startup noise that we
  // filter out below; it's the trade-off for using the user's existing
  // auth state.
  const systemAppend = [
    "You are a READ-ONLY question-answering assistant embedded in the Dokpilot dashboard.",
    "Dokpilot is the user's private skill for deploying GitHub repos to",
    "Dokploy VPS servers. The repo lives at " + REPO_ROOT + ".",
    "You are strictly read-only: you CANNOT run shell commands, deploy, fetch the",
    "web, or modify/write any files (Bash, Edit, Write, NotebookEdit and WebFetch",
    "are disabled). To ground an answer about apps, servers, deployments, domains,",
    "or databases, READ the relevant scripts and docs under skills/dokpilot/ (e.g.",
    "read skills/dokpilot/scripts/dokploy-api.sh to explain how a Dokploy call is",
    "made) and tell the user the exact command to run themselves — never claim to",
    "have executed anything. Keep answers concise — the user is in a dashboard,",
    "not a terminal.",
    contextHint ? "Context: " + contextHint : "",
  ].filter(Boolean).join(" ");

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--append-system-prompt", systemAppend,
    // Read-only Q&A: deny every mutating / side-effecting tool. Read, Grep,
    // Glob, etc. stay allowed so answers can be grounded in the repo. Tool
    // names must match what the installed claude accepts (T09.5: "MultiEdit"
    // is NOT a known tool, so it is intentionally omitted).
    "--disallowedTools", "Write Edit NotebookEdit Bash KillShell WebFetch",
    "--add-dir", REPO_ROOT,
  ];
  // Close stdin explicitly — `claude -p` waits 3s for piped stdin
  // before giving up; we have no piped input so close immediately.
  const child = spawn("claude", args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

/** Pick the interesting events out of stream-json line. Returns
 *  {type, payload} or null when the line should be skipped. */
function transformEvent(obj) {
  if (!obj || typeof obj !== "object") return null;
  const t = obj.type;

  // System events: filter out hooks (noise) but keep model + session info
  if (t === "system") {
    if (obj.subtype === "hook_started" || obj.subtype === "hook_response") return null;
    if (obj.subtype === "init") {
      return { event: "info", payload: { kind: "init", model: obj.model || null, session_id: obj.session_id } };
    }
    return null;
  }

  // Assistant text deltas
  if (t === "assistant") {
    const content = obj.message?.content;
    if (Array.isArray(content)) {
      // Collect text + tool_use parts
      const parts = [];
      for (const c of content) {
        if (c.type === "text") parts.push({ kind: "text", text: c.text });
        else if (c.type === "tool_use") parts.push({ kind: "tool_use", name: c.name, input: c.input, id: c.id });
        else if (c.type === "thinking") parts.push({ kind: "thinking", text: c.text || c.thinking || "" });
      }
      if (parts.length > 0) return { event: "delta", payload: { parts } };
    }
    return null;
  }

  // Stream-partial (token-by-token)
  if (t === "stream_event" || t === "content_block_delta") {
    return { event: "partial", payload: { delta: obj.delta || obj.text || "" } };
  }

  // Tool results — `r.content` can be a string OR an array of {type,text}.
  // Both shapes appear in the wild depending on which tool ran; normalize.
  if (t === "user" && Array.isArray(obj.message?.content)) {
    const toolResults = obj.message.content.filter(c => c.type === "tool_result");
    if (toolResults.length > 0) {
      return { event: "tool_result", payload: { results: toolResults.map(r => {
        let content = "";
        if (typeof r.content === "string") content = r.content;
        else if (Array.isArray(r.content)) content = r.content.map(c => c?.text).filter(Boolean).join("\n");
        else if (r.content && typeof r.content === "object") content = JSON.stringify(r.content);
        return { id: r.tool_use_id, error: !!r.is_error, content: content.slice(0, 600) };
      }) } };
    }
    return null;
  }

  // Permission denials
  if (t === "permission_denial") {
    return { event: "permission", payload: { tool: obj.tool_name, reason: obj.reason } };
  }

  // Final result
  if (t === "result") {
    return { event: "done", payload: {
      ok: !obj.is_error,
      duration_ms: obj.duration_ms,
      cost_usd: obj.total_cost_usd,
      text: obj.result,
      stop_reason: obj.stop_reason,
    } };
  }

  return null;
}

/** POST /api/assistant */
async function startSession(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body?.prompt) return json(res, 400, { error: "missing-prompt" });

  const id = newSessionId();
  const child = spawnClaude(body.prompt, { contextHint: body.context });
  const sess = {
    id,
    child,
    pid: child.pid,
    buffer: "",
    stream: null,
    events: [],         // ring buffer of events emitted while no SSE attached
    createdAt: Date.now(),
    closed: false,
  };
  sessions.set(id, sess);

  // Wire line buffering on stdout.
  // Wrap each line's transform in try/catch — never let a schema surprise
  // from the claude CLI crash the whole ui-server (was line 139 BUG that
  // killed the process in production).
  child.stdout.on("data", (chunk) => {
    sess.buffer += chunk.toString("utf8");
    let nl;
    while ((nl = sess.buffer.indexOf("\n")) >= 0) {
      const line = sess.buffer.slice(0, nl).trim();
      sess.buffer = sess.buffer.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      let ev = null;
      try { ev = transformEvent(obj); }
      catch (err) {
        console.error("[ui] transformEvent threw on line:", err.message);
        continue;
      }
      if (!ev) continue;
      if (sess.stream && !sess.stream.closed) {
        try { sess.stream.send(ev.event, ev.payload); } catch {}
      } else {
        sess.events.push(ev);   // buffer until SSE connects
        if (sess.events.length > 200) sess.events.shift();
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    if (sess.stream && !sess.stream.closed) sess.stream.send("stderr", { text });
  });

  child.on("exit", (code) => {
    sess.closed = true;
    if (sess.stream && !sess.stream.closed) {
      sess.stream.send("exit", { code });
      sess.stream.close("exit");
    }
    // Reap after 60s
    setTimeout(() => sessions.delete(id), 60_000);
  });

  child.on("error", (err) => {
    if (sess.stream && !sess.stream.closed) sess.stream.send("error", { message: err.message });
  });

  json(res, 201, { session_id: id, pid: child.pid });
}

/** GET /api/assistant/:session/stream */
function streamSession(req, res, ctx, params) {
  const sess = sessions.get(params.session);
  if (!sess) return json(res, 404, { error: "session-not-found", id: params.session });

  const stream = openStream(res);
  sess.stream = stream;

  // Flush any buffered events from before the SSE connected
  for (const ev of sess.events) stream.send(ev.event, ev.payload);
  sess.events = [];

  // If the child already exited, send exit and close
  if (sess.closed) {
    stream.send("exit", { code: 0 });
    stream.close("already-exited");
    return;
  }

  const ping = pingInterval(stream, 15_000);
  stream.onClose(() => {
    clearInterval(ping);
    // Don't kill the child on stream close — the user may reconnect.
    // Reaper above cleans up after 60s post-exit anyway.
  });
}

module.exports = {
  "POST /api/assistant":                 startSession,
  "GET /api/assistant/:session/stream":  streamSession,
};
