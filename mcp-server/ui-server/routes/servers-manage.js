"use strict";
const { json } = require("../lib/http");
const csrf = require("../lib/csrf");
const { dokploy, sshExec } = require("../lib/exec");
const {
  readRaw, writeRaw, storeApiKey, deleteApiKey, validateSshKeyPath, keychainAvailable,
} = require("../lib/config-write");

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on("data", (c) => { len += c.length; if (len > max) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { const b = Buffer.concat(chunks).toString("utf8"); if (!b) return resolve(null); try { resolve(JSON.parse(b)); } catch (e) { reject(Object.assign(new Error("invalid json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

const validName = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9_-]{0,38}$/i.test(s);

/* ─── SSH key registry ──────────────────────────────────────────────
   config.ssh_keys[<name>] = { path, added_at }. A server's ssh_key is
   still a plain PATH (ssh-exec.sh unchanged); the registry is a
   convenience list the UI offers + "used by" reverse-lookup by path. */

function listSshKeys(req, res) {
  const cfg = readRaw();
  const keys = cfg.ssh_keys || {};
  const servers = cfg.servers || {};
  const out = Object.entries(keys).map(([name, k]) => {
    const usedBy = Object.entries(servers).filter(([, s]) => s.ssh_key === k.path).map(([n]) => n);
    return { name, path: k.path, added_at: k.added_at, used_by: usedBy };
  });
  // Also surface ad-hoc key paths used by servers but not in the registry
  const registered = new Set(Object.values(keys).map(k => k.path));
  const adhoc = {};
  for (const [n, s] of Object.entries(servers)) {
    if (s.ssh_key && !registered.has(s.ssh_key)) {
      (adhoc[s.ssh_key] = adhoc[s.ssh_key] || []).push(n);
    }
  }
  json(res, 200, {
    keys: out,
    unregistered: Object.entries(adhoc).map(([path, used_by]) => ({ path, used_by })),
  });
}

async function addSshKey(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  const { name, path: keyPath } = body || {};
  if (!validName(name)) return json(res, 400, { error: "invalid-name", hint: "letters/digits/-/_ , ≤39 chars" });
  const v = validateSshKeyPath(keyPath);
  if (!v.ok) return json(res, 400, { error: "invalid-path", detail: v.error });
  const cfg = readRaw();
  cfg.ssh_keys = cfg.ssh_keys || {};
  cfg.ssh_keys[name] = { path: v.resolved, added_at: new Date().toISOString() };
  writeRaw(cfg);
  json(res, 201, { name, path: v.resolved, warning: v.warning });
}

function deleteSshKey(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const cfg = readRaw();
  const k = (cfg.ssh_keys || {})[params.name];
  if (!k) return json(res, 404, { error: "not-found" });
  const usedBy = Object.entries(cfg.servers || {}).filter(([, s]) => s.ssh_key === k.path).map(([n]) => n);
  if (usedBy.length) return json(res, 409, { error: "in-use", used_by: usedBy, hint: "reassign those servers first" });
  delete cfg.ssh_keys[params.name];
  writeRaw(cfg);
  json(res, 200, { deleted: params.name });
}

/* ─── Server CRUD ───────────────────────────────────────────────────
   POST /api/servers  Body:
     { name, host, ssh_user?, ssh_key (path | named:<key>),
       dokploy_url, dokploy_api_key?, make_default? }
   Creates or updates. API key → Keychain (ref in JSON). */

async function upsertServer(req, res, ctx) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  let body; try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }
  if (!body) return json(res, 400, { error: "missing-body" });

  const { name, host, ssh_user = "root", dokploy_url, dokploy_api_key, make_default } = body;
  let ssh_key = body.ssh_key;
  if (!validName(name)) return json(res, 400, { error: "invalid-name" });
  if (!host) return json(res, 400, { error: "missing-host" });
  if (!dokploy_url) return json(res, 400, { error: "missing-dokploy_url" });

  const cfg = readRaw();
  cfg.servers = cfg.servers || {};
  const existing = cfg.servers[name] || {};
  const warnings = [];

  // Resolve ssh_key: "named:<key>" → registry path, else validate raw path
  if (ssh_key && ssh_key.startsWith("named:")) {
    const keyName = ssh_key.slice("named:".length);
    const reg = (cfg.ssh_keys || {})[keyName];
    if (!reg) return json(res, 400, { error: "unknown-ssh-key", name: keyName });
    ssh_key = reg.path;
  } else if (ssh_key) {
    const v = validateSshKeyPath(ssh_key);
    if (!v.ok) return json(res, 400, { error: "invalid-ssh-key-path", detail: v.error });
    ssh_key = v.resolved;
    if (v.warning) warnings.push(v.warning);
  } else {
    ssh_key = existing.ssh_key || null;
  }

  // API key → Keychain (only if a new value was provided)
  let apiKeyRef = existing.dokploy_api_key;
  let secretSource = (existing.dokploy_api_key && existing.dokploy_api_key._secret) ? "keychain" : (existing.dokploy_api_key ? "file" : null);
  if (dokploy_api_key) {
    const stored = await storeApiKey(name, dokploy_api_key);
    // Refuse to persist a server with a plaintext API key: if the Keychain write
    // failed, abort the whole upsert (nothing is written to servers.json).
    if (stored.error) {
      return json(res, 502, { error: "secret-store-failed", detail: stored.detail || stored.error,
        note: "Server not saved — won't persist the API key in plaintext. Check Keychain access and retry." });
    }
    apiKeyRef = stored.ref;
    secretSource = stored.source;
    if (stored.warning) warnings.push(stored.warning);
  }

  cfg.servers[name] = {
    host,
    ssh_user,
    ssh_key,
    dokploy_url,
    dokploy_api_key: apiKeyRef,
    added_at: existing.added_at || new Date().toISOString(),
  };
  if (make_default || !cfg.defaults?.server) {
    cfg.defaults = cfg.defaults || {};
    cfg.defaults.server = name;
  }
  writeRaw(cfg);

  // Never echo the key back — only metadata
  json(res, 201, {
    server: { name, host, ssh_user, ssh_key, dokploy_url, secret_source: secretSource, is_default: cfg.defaults.server === name },
    warnings: warnings.length ? warnings : undefined,
  });
}

async function deleteServer(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const cfg = readRaw();
  if (!cfg.servers?.[params.name]) return json(res, 404, { error: "not-found" });
  delete cfg.servers[params.name];
  await deleteApiKey(params.name);   // best-effort Keychain cleanup
  if (cfg.defaults?.server === params.name) {
    const remaining = Object.keys(cfg.servers);
    cfg.defaults.server = remaining[0] || null;
  }
  writeRaw(cfg);
  json(res, 200, { deleted: params.name, new_default: cfg.defaults.server });
}

/* POST /api/servers/:name/test — validate SSH reachability + Dokploy API.
   Tests the SAVED config (call after upsert) — does not accept raw creds. */
async function testServer(req, res, ctx, params) {
  if (!csrf.check(req, ctx.token)) return json(res, 403, { error: "csrf" });
  const cfg = readRaw();
  if (!cfg.servers?.[params.name]) return json(res, 404, { error: "not-found" });

  const result = { ssh: null, dokploy: null };

  // SSH: a cheap echo round-trip
  const ssh = await sshExec(params.name, "echo dokpilot-ok && uname -s");
  result.ssh = ssh.__error
    ? { ok: false, error: (ssh.stderr || "ssh failed").slice(0, 200) }
    : { ok: /dokpilot-ok/.test(ssh.stdout), uname: (ssh.stdout.split("\n")[1] || "").trim() };

  // Dokploy: project.all (also our liveness probe)
  const dp = await dokploy(params.name, "GET", "project.all");
  result.dokploy = dp.__error
    ? { ok: false, error: (dp.stderr || "api failed").slice(0, 200) }
    : { ok: true, project_count: (Array.isArray(dp) ? dp : (dp.result?.data || [])).length };

  const allOk = result.ssh.ok && result.dokploy.ok;
  json(res, allOk ? 200 : 207, { ok: allOk, ...result });
}

module.exports = {
  "GET /api/ssh-keys":             listSshKeys,
  "POST /api/ssh-keys":            addSshKey,
  "DELETE /api/ssh-keys/:name":    deleteSshKey,
  "POST /api/servers":             upsertServer,
  "DELETE /api/servers/:name":     deleteServer,
  "POST /api/servers/:name/test":  testServer,
};
