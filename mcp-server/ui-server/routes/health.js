"use strict";
const { json } = require("../lib/http");
const { preflightClaude } = require("../lib/claude-preflight");

module.exports = {
  "GET /api/health": async (req, res, ctx) => {
    // The deploy runs a headless `claude`; expose whether it's usable so the
    // dashboard can warn up front (WS10 / T35). Memoized ~30s in the preflight.
    let claude;
    try { claude = await preflightClaude(); }
    catch { claude = { ok: null, state: "unknown", version: null, hint: null }; }
    json(res, 200, {
      status: "ok",
      version: "v4.0.0",
      port: ctx.port,
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      claude,
      ui_root: ctx.uiRoot,
    });
  },
};
