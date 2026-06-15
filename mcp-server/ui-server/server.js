#!/usr/bin/env node
/* Dokpilot UI server — Epic 1 (read-only API + UI wiring)
   Node 20+ stdlib only. No npm deps.

   Architecture:
     server.js (this file)
       - HTTP bootstrap
       - auth gate (token cookie + Origin check)
       - static file serving for dokpilot-ui/
       - route dispatch via lib/router.js
     lib/
       exec.js     — shell wrappers around skill scripts
       http.js     — response helpers
       router.js   — pattern matcher
     routes/
       health.js
       config.js
       servers.js
       apps.js
       domains.js
       databases.js
       secrets.js

   Security model unchanged from M0: 127.0.0.1 bind, random ephemeral
   port, 32-byte bearer token in URL → HttpOnly SameSite=Strict cookie
   on first GET (302 to clean URL), strict Origin/Referer check, no CORS.

   Args:
     --port <n>        explicit port (default: 0 = OS picks ephemeral)
     --token <hex>     explicit bearer token (default: generated 32-byte hex)
     --ui-root <path>  static root (default: <repo>/dokpilot-ui)
     --quiet           emit only the launch URL on stdout (one line)
*/
"use strict";

const http   = require("node:http");
const fs     = require("node:fs");
const path   = require("node:path");
const crypto = require("node:crypto");
const url    = require("node:url");

const { json, text } = require("./lib/http");
const { buildRouter } = require("./lib/router");

/* ─── args ──────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const PORT       = Number(arg("port", "0")) || 0;
const TOKEN      = arg("token") || crypto.randomBytes(16).toString("hex");
const REPO_ROOT  = path.resolve(__dirname, "..", "..");
const UI_ROOT    = path.resolve(arg("ui-root", path.join(REPO_ROOT, "dokpilot-ui")));
const QUIET      = hasFlag("quiet");
const NO_STATE   = hasFlag("no-state");   // don't write .ui-port/.ui-url/.ui-pid (smoke/CI — avoids clobbering the launcher's files)
const COOKIE_NAME = "dokpilot_token";

if (!fs.existsSync(path.join(UI_ROOT, "index.html"))) {
  console.error(`ui-server: cannot find index.html under ${UI_ROOT}`);
  process.exit(2);
}

/* ─── routes ────────────────────────────────────────────────────── */
const router = buildRouter([
  require("./routes/health"),
  require("./routes/config"),
  require("./routes/servers"),
  require("./routes/apps"),
  require("./routes/logs"),
  require("./routes/overview"),
  require("./routes/rollback"),
  require("./routes/docker"),
  require("./routes/backups"),
  require("./routes/notifications"),
  require("./routes/onboarding"),
  require("./routes/domains"),
  require("./routes/databases"),
  require("./routes/secrets"),
  require("./routes/streams"),
  require("./routes/queue"),
  require("./routes/jobs"),
  require("./routes/writes"),
  require("./routes/destroy"),
  require("./routes/assistant"),
  require("./routes/servers-manage"),
]);

/* ─── helpers ───────────────────────────────────────────────────── */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".map":  "application/json; charset=utf-8",
};

const parseCookies = (header) => {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
};

const safeEqual = (a, b) => {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

function checkAuth(req, port) {
  const u = url.parse(req.url, true);
  const cookies = parseCookies(req.headers.cookie);
  const cookieTok = cookies[COOKIE_NAME];
  const queryTok = u.query.t;
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  let source = null;
  if (safeEqual(cookieTok, TOKEN)) source = "cookie";
  else if (safeEqual(queryTok, TOKEN)) source = "query";
  else if (safeEqual(bearer, TOKEN)) source = "bearer";
  if (!source) return { ok: false, reason: "token" };

  const expectedHost = `127.0.0.1:${port}`;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin && !origin.endsWith(expectedHost)) return { ok: false, reason: "origin" };
  if (referer && !referer.includes(expectedHost)) return { ok: false, reason: "referer" };

  return { ok: true, source };
}

function setTokenCookie(res) {
  res.setHeader("set-cookie",
    `${COOKIE_NAME}=${encodeURIComponent(TOKEN)}; Path=/; HttpOnly; SameSite=Strict`);
}

const missingTokenPage = (reason) =>
  `<!doctype html><meta charset=utf-8><title>Dokpilot UI — missing token</title>` +
  `<body style="font:13px/1.5 ui-monospace,Menlo,monospace;background:#0a0b0c;color:#e8e9eb;padding:40px;">` +
  `<div style="max-width:520px;margin:0 auto;">` +
  `<h1 style="color:#39ff14;font-size:18px;margin:0 0 12px;">missing or invalid token</h1>` +
  `<p>Reason: <code>${reason}</code></p>` +
  `<p>Launch the dashboard via <code>/dokpilot ui</code> in Claude Code. The launcher generates a per-session token and opens the correct URL.</p>` +
  `<p style="color:#6c7178;">The dashboard refuses direct visits without a launch-issued token. This protects against accidental remote access and CSRF.</p>` +
  `</div>`;

/* ─── handlers ──────────────────────────────────────────────────── */
function handleStatic(req, res) {
  const u = url.parse(req.url);
  let p = decodeURIComponent(u.pathname || "/");
  if (p === "/" || p === "") p = "/index.html";

  const target = path.resolve(UI_ROOT, "." + p);
  if (!target.startsWith(UI_ROOT + path.sep) && target !== UI_ROOT) {
    return text(res, 403, "forbidden");
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) return text(res, 404, "not found");
    const ext = path.extname(target).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";

    // For HTML responses, inject the bearer token as a window global so
    // client-side fetch() can use Authorization: Bearer reliably.
    // Cookie-based auth still works as a backup, but some browsers
    // (especially automated/headless ones) drop HttpOnly+SameSite=Strict
    // cookies set on a 302 redirect — bearer header sidesteps that.
    if (ext === ".html") {
      fs.readFile(target, "utf8", (rerr, html) => {
        if (rerr) return text(res, 500, "read failed");
        const injection = `<script>window.__DOKPILOT_TOKEN__=${JSON.stringify(TOKEN)};</script>`;
        // Inject before </head> if present, else before </body>, else at start
        let patched;
        if (/<\/head>/i.test(html))      patched = html.replace(/<\/head>/i, injection + "</head>");
        else if (/<\/body>/i.test(html)) patched = html.replace(/<\/body>/i, injection + "</body>");
        else                              patched = injection + html;
        const buf = Buffer.from(patched);
        res.writeHead(200, {
          "content-type": mime,
          "content-length": buf.length,
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "cache-control": "no-cache",
        });
        res.end(buf);
      });
      return;
    }

    res.writeHead(200, {
      "content-type": mime,
      "content-length": st.size,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": "no-cache",
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ─── request dispatcher ────────────────────────────────────────── */
function dispatch(req, res, port) {
  // Host check
  const host = (req.headers.host || "").split(":")[0];
  if (host && host !== "127.0.0.1" && host !== "localhost") {
    return text(res, 403, "host mismatch");
  }

  const u = url.parse(req.url, true);
  const cookies = parseCookies(req.headers.cookie);
  const queryTok = u.query.t;

  // First-hit: token in query → set cookie as a backup, but DO NOT redirect.
  // Browsers (especially automation contexts like Comet/Playwright) frequently
  // drop HttpOnly+SameSite=Strict cookies set on a 302 response, breaking
  // the auth flow. Instead we serve the HTML directly. The HTML embeds the
  // token via window.__DOKPILOT_TOKEN__ (see handleStatic), and the client
  // uses Authorization: Bearer for /api/* — no cookie reliance.
  // The ?t= stays in the URL initially; client-side JS cleans it via
  // history.replaceState() (see app.js bootData).
  if (queryTok && !u.pathname.startsWith("/api/")) {
    const auth = checkAuth(req, port);
    if (auth.ok) setTokenCookie(res); // best-effort backup
  }

  // Auth gate
  const auth = checkAuth(req, port);
  if (!auth.ok) {
    if (req.method === "GET" && !u.pathname.startsWith("/api/")) {
      return text(res, 401, missingTokenPage(auth.reason), "text/html; charset=utf-8");
    }
    return json(res, 401, { error: "unauthorized", reason: auth.reason });
  }

  // Route /api/* via the router
  if (u.pathname.startsWith("/api/")) {
    const match = router(req);
    if (!match) {
      return json(res, 404, {
        error: "no-route",
        message: `No route registered for ${req.method} ${u.pathname}`,
      });
    }
    const ctx = { port, uiRoot: UI_ROOT, token: TOKEN };
    return Promise.resolve(match.handler(req, res, ctx, match.params))
      .catch((err) => {
        console.error("[ui] route error:", err);
        if (!res.headersSent) json(res, 500, { error: "internal", message: String(err?.message || err) });
      });
  }

  if (req.method !== "GET" && req.method !== "HEAD") return text(res, 405, "method not allowed");
  return handleStatic(req, res);
}

/* ─── boot ──────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const port = server.address().port;
  try { dispatch(req, res, port); }
  catch (err) {
    console.error("[ui] dispatch error:", err);
    if (!res.headersSent) json(res, 500, { error: "internal", message: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const actualPort = server.address().port;
  const launchUrl = `http://127.0.0.1:${actualPort}/?t=${TOKEN}`;

  // Write state files atomically so the launcher (or any concurrent
  // reader) can pick up the URL without racing on a FIFO. The state
  // dir is created by launch.sh, but be defensive in case the server
  // is started directly.
  const stateDir = path.join(process.env.HOME || ".", ".claude", "skills", "dokpilot");
  if (!NO_STATE) try {
    fs.mkdirSync(stateDir, { recursive: true });
    const writeAtomic = (filename, content) => {
      const target = path.join(stateDir, filename);
      const tmp = target + ".tmp-" + process.pid;
      fs.writeFileSync(tmp, content, { mode: 0o600 });
      fs.renameSync(tmp, target);
    };
    writeAtomic(".ui-port", String(actualPort));
    writeAtomic(".ui-url",  launchUrl);
    writeAtomic(".ui-pid",  String(process.pid));
  } catch (e) {
    if (!QUIET) console.error("[ui] state-file write failed:", e.message);
  }

  if (QUIET) {
    process.stdout.write(launchUrl + "\n");
  } else {
    console.log(JSON.stringify({
      url: launchUrl,
      port: actualPort,
      token_preview: TOKEN.slice(0, 6) + "…" + TOKEN.slice(-4),
      pid: process.pid,
      ui_root: UI_ROOT,
    }, null, 2));
  }
});

process.on("SIGINT",  () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

// Last-resort error swallowers — the ui-server should NEVER crash in
// front of the user. Route handlers already have their own try/catch;
// these catch async stragglers (e.g. an SSE handler that throws on a
// pipe that closed during a write). Log + continue.
process.on("uncaughtException",  (err) => console.error("[ui] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[ui] unhandled:", err));
