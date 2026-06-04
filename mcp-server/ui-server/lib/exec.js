/* lib/exec.js — promisified shell wrappers around skill scripts.
   All shell-outs run with stdio captured, 15s timeout, env-isolated.
   No user input is concatenated into shell strings — scripts always
   receive argv items, never interpolated strings.

   The skill scripts live at <repo>/skills/dokpilot/scripts/. We
   resolve REPO_ROOT once from this file's location (ui-server/lib/
   → ../../ → repo root).
*/
"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS_DIR = path.join(REPO_ROOT, "skills", "dokpilot", "scripts");
const CONFIG_PATH = path.join(REPO_ROOT, "skills", "dokpilot", "config", "servers.json");

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB

/**
 * Run a command and return { stdout, stderr, code }. Never throws on
 * non-zero exit — callers inspect `code` and decide. Throws only on
 * spawn errors (missing binary, etc.) — these are programmer faults.
 */
function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, {
      timeout: opts.timeout ?? TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
    }, (err, stdout, stderr) => {
      const code = err ? (err.code === "ETIMEDOUT" ? 124 : (err.code ?? 1)) : 0;
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        code,
        timedOut: err?.code === "ETIMEDOUT",
      });
    });
  });
}

/**
 * Run a script under scripts/dokpilot/scripts/ via bash. Used because
 * the scripts have set -euo pipefail headers and assume bash semantics.
 */
function runScript(name, args, opts = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, name);
  return run("bash", [scriptPath, ...args], opts);
}

/* ─── dokploy-api.sh ────────────────────────────────────────────── */
/** Calls Dokploy tRPC. Returns parsed JSON or { error } on failure.
 *  `opts` is passed to runScript — e.g. { env: { DOKPILOT_CONFIRM_DESTROY: "1" } }
 *  for the dashboard's already-confirmed destructive deletes (the script refuses
 *  project.remove / application.delete / compose.delete without it). */
async function dokploy(server, method, endpoint, body, opts = {}) {
  const args = [server, method, endpoint];
  if (body != null) args.push(typeof body === "string" ? body : JSON.stringify(body));
  const { stdout, stderr, code, timedOut } = await runScript("dokploy-api.sh", args, opts);
  if (code !== 0) {
    return { __error: true, code, stderr: stderr.slice(0, 800), timedOut };
  }
  // Many Dokploy mutations (application.redeploy, killBuild, cleanQueues,
  // application.deploy, …) acknowledge with an empty body on success. Treat
  // that as { ok: true } so callers don't see a spurious "non-json response".
  if (!stdout.trim()) return { ok: true };
  try {
    return JSON.parse(stdout);
  } catch (e) {
    return { __error: true, code: 4, message: "non-json response", raw: stdout.slice(0, 200) };
  }
}

/** Like dokploy() but returns the RAW response text without JSON-parsing.
 *  Dokploy's log endpoints (application.readLogs, compose.readLogs,
 *  deployment.readLogs) return plain text, which the JSON-parsing
 *  dokploy() would mis-flag as an error. Returns { text } or { __error }. */
async function dokployRaw(server, method, endpoint, body) {
  const args = [server, method, endpoint];
  if (body != null) args.push(typeof body === "string" ? body : JSON.stringify(body));
  const { stdout, stderr, code, timedOut } = await runScript("dokploy-api.sh", args);
  if (code !== 0) {
    return { __error: true, code, stderr: stderr.slice(0, 800), timedOut };
  }
  return { text: stdout };
}

/* ─── cloudflare-dns.sh ─────────────────────────────────────────── */
/**
 * Cloudflare wrapper. The script accepts subcommands `list <zone>`,
 * `create <zone> <name> <type> <content>`, `delete <zone> <record-id>`.
 * We only need `list` for read-only milestones.
 */
async function cloudflareList(zone) {
  const r = await runScript("cloudflare-dns.sh", ["list", zone]);
  if (r.code !== 0) return { __error: true, code: r.code, stderr: r.stderr.slice(0, 800) };

  // The script emits pretty-printed JSON objects concatenated (no array
  // wrapper). Use a brace-counter to walk the stream and extract each
  // balanced { ... } block — this handles both single-line and
  // multi-line pretty-printed forms.
  const records = [];
  let depth = 0, start = -1;
  let inString = false, escape = false;
  for (let i = 0; i < r.stdout.length; i++) {
    const c = r.stdout[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const chunk = r.stdout.slice(start, i + 1);
        try {
          const obj = JSON.parse(chunk);
          records.push({
            name: obj.name,
            content: obj.content,
            type: obj.type || "A",
            proxied: !!obj.proxied,
            id: obj.id || null,
            ttl: obj.ttl || null,
          });
        } catch { /* skip malformed chunk */ }
        start = -1;
      }
    }
  }
  return { records };
}

/** Create a CF DNS A-record. Always --no-proxy (Let's Encrypt HTTP-01
 *  challenge needs the record to point directly at the origin so
 *  CertBot can verify; the user can flip to proxied later via the CF
 *  dashboard or a follow-up call). */
async function cloudflareCreate(host, ip) {
  const r = await runScript("cloudflare-dns.sh", ["create", host, ip, "--no-proxy"]);
  if (r.code !== 0) return { __error: true, code: r.code, stderr: r.stderr.slice(0, 800) };
  // Script prints created record info as JSON on success
  try {
    const obj = JSON.parse(r.stdout.trim());
    return { record: obj };
  } catch {
    return { record: { name: host, content: ip, proxied: false } };
  }
}

async function cloudflareDelete(host) {
  const r = await runScript("cloudflare-dns.sh", ["delete", host]);
  if (r.code !== 0) return { __error: true, code: r.code, stderr: r.stderr.slice(0, 800) };
  return { deleted: host };
}

/* ─── ssh-exec.sh ───────────────────────────────────────────────── */
/** Runs an arbitrary command via SSH on a server, returns trimmed stdout. */
async function sshExec(server, cmd) {
  // ssh-exec.sh is interactive in spirit; we shell-quote the command and
  // pass it as a single arg. Multi-arg form would also work but the script
  // joins them anyway.
  const r = await runScript("ssh-exec.sh", [server, cmd]);
  if (r.code !== 0) return { __error: true, code: r.code, stderr: r.stderr.slice(0, 800) };
  return { stdout: r.stdout };
}

/* ─── keys CLI (keys-keeper) ────────────────────────────────────── */
/** Lists all secret names + types (no values). */
async function keysList() {
  // Use the user's local install — same path the skill uses
  const keysBin = path.join(process.env.HOME || "", ".local", "bin", "keys");
  if (!fs.existsSync(keysBin)) {
    return { __error: true, code: 127, message: "keys CLI not installed" };
  }
  const r = await run(keysBin, ["list", "--json"]);
  if (r.code !== 0) {
    // Fall back to parsing the human-readable form if --json isn't supported
    const r2 = await run(keysBin, ["list"]);
    if (r2.code !== 0) return { __error: true, code: r.code, stderr: r.stderr.slice(0, 400) };
    // Parse "<type> <name> [tags]" lines
    const items = r2.stdout.split("\n").filter(Boolean).map(line => {
      const m = line.match(/^(\S+)\s+(\S+)\s*(?:\[(.+)\])?$/);
      if (!m) return null;
      return { type: m[1], name: m[2], tags: m[3] ? m[3].split(",").map(s => s.trim()) : [] };
    }).filter(Boolean);
    return { items };
  }
  try { return JSON.parse(r.stdout); }
  catch { return { __error: true, code: 4, message: "non-json from keys list" }; }
}

/* ─── config reader ─────────────────────────────────────────────── */
/**
 * Reads config/servers.json fresh on every call (per D-005: never
 * cache — user may edit in another terminal). Masks secret values.
 * Returns null + reason if config is missing or malformed.
 */
function readConfig({ maskSecrets = true } = {}) {
  let raw;
  try { raw = fs.readFileSync(CONFIG_PATH, "utf8"); }
  catch (e) { return { __error: true, code: 1, message: "config/servers.json not found", path: CONFIG_PATH }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { __error: true, code: 4, message: "config/servers.json is not valid JSON" }; }

  if (!maskSecrets) return parsed;

  const masked = JSON.parse(JSON.stringify(parsed));
  const isSecretField = (k) => k === "dokploy_api_key" || k === "api_token" || k === "ssh_key";
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (isSecretField(k)) {
        if (typeof v === "string") {
          // ssh_key is a path — keep last 12 chars; others mask entirely
          if (k === "ssh_key") obj[k] = { _kind: "path", preview: "…" + v.slice(-12) };
          else obj[k] = { _kind: "secret", source: "file" };
        } else if (v && typeof v === "object" && v._secret) {
          obj[k] = { _kind: "secret", source: "keychain", account: v._secret };
        } else if (v == null) {
          obj[k] = { _kind: "secret", source: "missing" };
        }
      } else {
        walk(v);
      }
    }
  };
  walk(masked);
  return masked;
}

/** Get server names from config (used to iterate API calls). */
function listServerNames() {
  const cfg = readConfig({ maskSecrets: false });
  if (cfg.__error) return [];
  return Object.keys(cfg.servers || {});
}

/* ─── parallel helper ───────────────────────────────────────────── */
/**
 * Promise.allSettled with a tag — preserves per-key error info so the
 * route handler can render partial success ("main: ok, edge: timeout").
 */
async function allSettledMap(entries, fn) {
  const out = {};
  await Promise.all(entries.map(async (key) => {
    try {
      out[key] = await fn(key);
    } catch (e) {
      out[key] = { __error: true, code: -1, message: String(e?.message || e) };
    }
  }));
  return out;
}

module.exports = {
  REPO_ROOT,
  SCRIPTS_DIR,
  CONFIG_PATH,
  run,
  runScript,
  dokploy,
  dokployRaw,
  cloudflareList,
  cloudflareCreate,
  cloudflareDelete,
  sshExec,
  keysList,
  readConfig,
  listServerNames,
  allSettledMap,
};
