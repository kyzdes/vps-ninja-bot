/* lib/config-write.js — mutate config/servers.json + Keychain.
   Used by routes/servers-manage.js. All writes atomic (tmp+rename).

   Security model (matches the skill's existing secret-store design):
   - Dokploy API keys go into macOS Keychain via secret-store.sh; the
     JSON stores a {"_secret":"<account>"} reference. On non-macOS (no
     Keychain) we fall back to plaintext + flag it in the response.
   - SSH keys are referenced by PATH only — the key material is never
     read, copied, or transmitted. We validate the path exists + is a
     readable regular file and warn on loose perms.
   - Secret VALUES are never echoed back in any response.
*/
"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const os   = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { CONFIG_PATH, SCRIPTS_DIR } = require("./exec");

function readRaw() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return { servers: {}, ssh_keys: {}, cloudflare: {}, defaults: {} }; }
}

function writeRaw(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG_PATH + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  return cfg;
}

/** Run secret-store.sh <action> [args]. Returns {ok, stdout, code}. */
function secretStore(args) {
  return new Promise((resolve) => {
    execFile("bash", [path.join(SCRIPTS_DIR, "secret-store.sh"), ...args], { timeout: 8000 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || "").trim(), stderr: String(stderr || "") });
      });
  });
}

async function keychainAvailable() {
  const r = await secretStore(["available"]);
  return r.ok;
}

/** Write a secret to the Keychain with the VALUE passed via STDIN, so it never
 *  appears in this process's argv / `ps`. Returns { ok, code, stderr }. */
function secretStoreSet(account, value) {
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(SCRIPTS_DIR, "secret-store.sh"), "set", account], { timeout: 8000 });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ ok: false, code: 1, stderr: String(e.message) }));
    child.on("close", (code) => resolve({ ok: code === 0, code: code ?? 1, stderr: stderr.slice(0, 200) }));
    try { child.stdin.write(value); child.stdin.end(); } catch { /* 'error' event resolves it */ }
  });
}

/** Store a Dokploy API key. Returns the JSON reference on success.
 *  Policy: NEVER persist a secret in plaintext when a Keychain is available.
 *   - Keychain present + write ok   → { ref: {_secret}, source:"keychain" }
 *   - Keychain present + write fail  → { error } — caller MUST abort (no plaintext)
 *   - Keychain absent (non-macOS)    → { ref: value, source:"file", warning } — the
 *     only platform without an OS secret store; surfaced loudly. */
async function storeApiKey(serverName, value) {
  const account = `${serverName}:dokploy_api_key`;
  if (await keychainAvailable()) {
    const r = await secretStoreSet(account, value);
    if (r.ok) return { ref: { _secret: account }, source: "keychain" };
    return { error: "keychain-write-failed", detail: r.stderr };
  }
  return { ref: value, source: "file",
    warning: "No OS Keychain on this platform — refusing to silently persist the API key in plaintext is not possible here; configure on macOS (Keychain) or via keys-keeper instead." };
}

async function deleteApiKey(serverName) {
  const account = `${serverName}:dokploy_api_key`;
  if (await keychainAvailable()) await secretStore(["delete", account]);
}

/** Validate an SSH private-key path. Returns {ok, warning?} or {ok:false, error}. */
function validateSshKeyPath(p) {
  if (!p) return { ok: false, error: "empty path" };
  // Expand ~ to home
  let resolved = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
  resolved = path.resolve(resolved);
  let st;
  try { st = fs.statSync(resolved); }
  catch { return { ok: false, error: "path not found: " + resolved }; }
  if (!st.isFile()) return { ok: false, error: "not a regular file: " + resolved };
  try { fs.accessSync(resolved, fs.constants.R_OK); }
  catch { return { ok: false, error: "not readable: " + resolved }; }
  // SSH refuses keys with group/other perms. Warn (don't block — user may chmod).
  const mode = st.mode & 0o077;
  const warning = mode !== 0 ? "key perms are loose (" + (st.mode & 0o777).toString(8) + "); ssh wants 0600 — run: chmod 600 " + resolved : null;
  return { ok: true, resolved, warning };
}

module.exports = {
  readRaw,
  writeRaw,
  secretStore,
  keychainAvailable,
  storeApiKey,
  deleteApiKey,
  validateSshKeyPath,
};
