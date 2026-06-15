/* lib/manifest.js — the deploy trust boundary.
   Zero-dep (pure JS, no node: imports needed).

   WHY this exists (WS1 / D-019):
   The two-phase worker NEVER lets the deploy phase (Phase B, a bypassPermissions
   claude) read raw repository bytes as instructions. Instead, a read-only Phase A
   analyzes the untrusted repo and emits a STRUCTURED stack manifest. That manifest
   is the ONLY thing that crosses from "untrusted repo" into "trusted infra actuation".
   So this validator must be paranoid: a Phase A that was prompt-injected could emit a
   shape-valid manifest with hostile values, and this is the choke point that contains it.

   GUARANTEES:
   - Only allowlisted keys survive (unknown/injected keys are stripped).
   - env_keys_needed are NAMES ONLY (/^[A-Z][A-Z0-9_]{0,63}$/). Any element that
     carries a VALUE (object with value/val, or "KEY=value" string) is a HARD REJECT
     (D-012: we never carry secret values through the manifest).
   - Enums are checked; out-of-enum required fields coerce to a safe default or reject.
   - Lengths are capped (defends against a manifest that's a wall of injected text).
   - Freeform / shell-metacharacter build_cmd / start_cmd are NOT rejected but FLAGGED.
     Phase B is bound (by lib/worker-guard.js) to SURFACE every flagged command in the
     plan-then-confirm gate for explicit human review and to NEVER auto-run it.

   API:  validateManifest(raw) -> { ok, manifest|null, flags: string[], errors: string[] }
*/
"use strict";

const MANIFEST_SCHEMA_VERSION = 1;

// Allowlisted stacks / build types / databases. "unknown" is always permitted so a
// genuinely unrecognized repo degrades gracefully rather than failing the deploy.
const STACKS = new Set([
  "node", "nextjs", "nuxt", "angular", "react", "static",
  "python", "go", "rust", "ruby", "java", "php", "docker", "compose", "unknown",
]);
const BUILD_TYPES = new Set(["nixpacks", "dockerfile", "compose", "static", "unknown"]);
const DB_KINDS = new Set(["postgres", "mysql", "mariadb", "mongo", "redis"]);

const MAX_STR = 200;       // generic string cap
const MAX_NOTES = 500;     // notes cap
const MAX_ARRAY = 32;      // array element cap
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
// Shell metacharacters / multi-command markers that make a command "freeform".
const METACHAR_RE = /[;&|`$(){}<>\n\r]|\$\(|&&|\|\||>>|\bcurl\b|\bwget\b|\bsh\b\s|\beval\b/;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function capStr(v, max) {
  if (typeof v !== "string") return null;
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Validate + sanitize a manifest object parsed from Phase A's output.
 * Returns a NEW object containing only allowlisted, sanitized fields.
 */
function validateManifest(raw) {
  const errors = [];
  const flags = [];

  if (!isPlainObject(raw)) {
    return { ok: false, manifest: null, flags, errors: ["manifest is not a JSON object"] };
  }

  const out = { manifest_schema_version: MANIFEST_SCHEMA_VERSION };

  // ── stack (coerce unknown rather than fail) ───────────────────────────
  out.stack = STACKS.has(raw.stack) ? raw.stack : "unknown";
  if (!STACKS.has(raw.stack)) flags.push(`stack "${String(raw.stack).slice(0, 40)}" not recognized -> unknown`);

  // ── framework (free string, capped, optional) ─────────────────────────
  out.framework = raw.framework == null ? null : capStr(String(raw.framework), MAX_STR);

  // ── port (1..65535 or null) ───────────────────────────────────────────
  const p = Number(raw.port);
  out.port = Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;

  // ── build.type (enum, coerce unknown) ─────────────────────────────────
  const bt = isPlainObject(raw.build) ? raw.build.type : raw.build_type;
  out.build_type = BUILD_TYPES.has(bt) ? bt : "unknown";

  out.has_dockerfile = raw.has_dockerfile === true;
  out.has_compose = raw.has_compose === true;

  // ── env_keys_needed: NAMES ONLY — value-bearing entries are a HARD reject ─
  out.env_keys_needed = [];
  const envRaw = Array.isArray(raw.env_keys_needed) ? raw.env_keys_needed
    : Array.isArray(raw.env_keys) ? raw.env_keys : [];
  if (envRaw.length > MAX_ARRAY) {
    flags.push(`env_keys_needed truncated ${envRaw.length} -> ${MAX_ARRAY}`);
  }
  for (const e of envRaw.slice(0, MAX_ARRAY)) {
    if (isPlainObject(e)) {
      // {name:"X", value:"secret"} style — carries a value. Refuse the whole manifest.
      if ("value" in e || "val" in e || "secret" in e) {
        errors.push("env_keys_needed contains a value-bearing entry (D-012 violation): names only");
        continue;
      }
      const name = e.name || e.key;
      if (typeof name === "string" && ENV_KEY_RE.test(name)) out.env_keys_needed.push(name);
      else flags.push(`dropped invalid env key entry: ${JSON.stringify(e).slice(0, 60)}`);
      continue;
    }
    if (typeof e === "string") {
      // "KEY=value" smuggles a value through a string — refuse.
      if (e.includes("=")) {
        errors.push(`env_keys_needed entry "${e.slice(0, 40)}" carries a value (D-012): names only`);
        continue;
      }
      if (ENV_KEY_RE.test(e)) out.env_keys_needed.push(e);
      else flags.push(`dropped invalid env key name: ${e.slice(0, 40)}`);
      continue;
    }
    flags.push("dropped non-string env key entry");
  }

  // ── db_needs (enum-filtered) ──────────────────────────────────────────
  out.db_needs = [];
  const dbRaw = Array.isArray(raw.db_needs) ? raw.db_needs : [];
  for (const d of dbRaw.slice(0, MAX_ARRAY)) {
    if (DB_KINDS.has(d)) out.db_needs.push(d);
    else flags.push(`dropped unknown db kind: ${String(d).slice(0, 40)}`);
  }

  // ── build_cmd / start_cmd: keep but FLAG freeform/metachar commands ────
  for (const field of ["build_cmd", "start_cmd"]) {
    const v = raw[field];
    if (v == null) { out[field] = null; continue; }
    const s = capStr(String(v), MAX_STR);
    out[field] = s;
    if (s && METACHAR_RE.test(s)) {
      flags.push(`${field} contains shell metacharacters and must be human-reviewed (never auto-run): ${s.slice(0, 80)}`);
    }
  }

  // ── notes (capped free text) ──────────────────────────────────────────
  out.notes = raw.notes == null ? "" : capStr(String(raw.notes), MAX_NOTES);

  // Record which build/start commands were flagged so callers don't re-derive it.
  out.flagged_commands = flags.filter(f => /build_cmd|start_cmd/.test(f));

  const ok = errors.length === 0;
  return { ok, manifest: ok ? out : null, flags, errors };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  STACKS,
  BUILD_TYPES,
  DB_KINDS,
  ENV_KEY_RE,
  validateManifest,
};
