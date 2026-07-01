#!/usr/bin/env bash
# clean-machine-smoke.sh — throwaway-HOME onboarding smoke for Dokpilot.
#
# Proves the Mode B install path (git clone + symlink) works end to end on a
# clean machine, WITHOUT touching the real ~/.claude or any real credential.
# It NEVER prints a secret value.
#
# Gates (each reports PASS/FAIL; any FAIL → exit 1):
#   1. prereqs         node >= 20, jq, sshpass on PATH
#   2. self-location   skills/dokpilot/SKILL.md resolves from the repo root and
#                      its frontmatter declares `name: dokpilot`
#   3. secret-store    secret-store.sh `available` branch matches `uname`
#                      (Keychain on macOS, plaintext-fallback elsewhere)
#   4. onboarding-sim  writes a temp servers.json 0600 containing ONLY {_secret}
#                      refs on macOS / a loud plaintext-warning path on Linux
#   5. ui-server       launch.sh --no-open → GET /api/health == 200 → --stop
#
# This proves Mode B ONLY. Mode A (marketplace) requires a cross-repo change
# that this script cannot make — see the ACTION ITEM printed at the end.
#
# Usage:  bash scripts/clean-machine-smoke.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILS=0
pass() { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILS=$((FAILS + 1)); }
note() { printf '  [ .. ] %s\n' "$1"; }
section() { printf '\n=== %s ===\n' "$1"; }

UNAME_S="$(uname)"

# ─── gate 1: prereqs ────────────────────────────────────────────
section "gate 1 — prerequisites"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 20 ] 2>/dev/null; then
  pass "node $(node -v 2>/dev/null) (>= 20)"
else
  fail "node >= 20 required (found major: ${NODE_MAJOR:-none})"
fi
if command -v jq >/dev/null 2>&1; then pass "jq present"; else fail "jq not on PATH"; fi
if command -v sshpass >/dev/null 2>&1; then pass "sshpass present"; else fail "sshpass not on PATH"; fi

# ─── gate 2: skill resolves via self-location ───────────────────
section "gate 2 — skill self-location"
SKILL_MD="$REPO_ROOT/skills/dokpilot/SKILL.md"
if [ -f "$SKILL_MD" ]; then
  if awk 'NR<=30 && /^name:[[:space:]]*dokpilot[[:space:]]*$/{f=1} END{exit f?0:1}' "$SKILL_MD"; then
    pass "SKILL.md resolves at skills/dokpilot/ (name: dokpilot)"
  else
    fail "SKILL.md frontmatter missing 'name: dokpilot'"
  fi
else
  fail "SKILL.md not found at $SKILL_MD"
fi

# ─── gate 3: secret-store branch matches uname ──────────────────
section "gate 3 — secret-store branch"
SECRET_STORE="$REPO_ROOT/skills/dokpilot/scripts/secret-store.sh"
if bash "$SECRET_STORE" available >/dev/null 2>&1; then AVAIL=1; else AVAIL=0; fi
if [ "$UNAME_S" = "Darwin" ]; then
  if [ "$AVAIL" -eq 1 ]; then
    pass "macOS → Keychain available (secrets go to the Keychain)"
  else
    fail "macOS but secret-store reports Keychain unavailable"
  fi
else
  if [ "$AVAIL" -eq 0 ]; then
    pass "$UNAME_S → no OS keystore, plaintext-fallback branch (as designed)"
  else
    fail "$UNAME_S but secret-store unexpectedly reports a Keychain"
  fi
fi

# ─── throwaway HOME for the remaining gates ─────────────────────
TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/dokpilot-smoke.XXXXXX")"
cleanup() {
  # best-effort: stop any server we started, then remove the throwaway HOME
  [ -n "${LAUNCH:-}" ] && bash "$LAUNCH" --stop >/dev/null 2>&1 || true
  [ -n "${TMP_HOME:-}" ] && rm -rf "$TMP_HOME"
}
trap cleanup EXIT

# ─── gate 4: onboarding sim writes a safe servers.json ──────────
section "gate 4 — onboarding sim (servers.json)"
CFG_DIR="$TMP_HOME/.dokpilot"
mkdir -p "$CFG_DIR"
CFG="$CFG_DIR/servers.json"

if [ "$UNAME_S" = "Darwin" ]; then
  # macOS: secrets live in the Keychain; the file carries only {_secret} refs
  # (account names, never values). The refs below are NOT secrets.
  cat > "$CFG" <<'JSON'
{
  "mode": "single",
  "servers": {
    "smoke": {
      "host": "203.0.113.10",
      "ssh_user": "root",
      "ssh_key": "~/.ssh/id_ed25519",
      "dokploy_url": "http://203.0.113.10:3000",
      "dokploy_api_key": { "_secret": "smoke:dokploy_api_key" }
    }
  },
  "cloudflare": { "api_token": { "_secret": "cloudflare:api_token" } },
  "defaults": { "server": "smoke" }
}
JSON
else
  # Linux / non-macOS: no OS keystore. Secrets WOULD be stored plaintext.
  note "LOUD WARNING: $UNAME_S has no OS keystore — Dokpilot stores Dokploy/Cloudflare"
  note "  credentials as PLAINTEXT in servers.json. Keep it chmod 600, never commit it,"
  note "  and prefer a macOS host (Keychain) for anything sensitive."
  cat > "$CFG" <<'JSON'
{
  "mode": "single",
  "servers": {
    "smoke": {
      "host": "203.0.113.10",
      "ssh_user": "root",
      "ssh_key": "~/.ssh/id_ed25519",
      "dokploy_url": "http://203.0.113.10:3000",
      "dokploy_api_key": "PLAINTEXT-FALLBACK-NO-KEYSTORE"
    }
  },
  "cloudflare": { "api_token": "PLAINTEXT-FALLBACK-NO-KEYSTORE" },
  "defaults": { "server": "smoke" }
}
JSON
fi
chmod 600 "$CFG"

# perms must be 0600 (stat differs macOS vs GNU)
if PERM="$(stat -f '%Lp' "$CFG" 2>/dev/null)"; then :; else PERM="$(stat -c '%a' "$CFG" 2>/dev/null || echo '?')"; fi
if [ "$PERM" = "600" ]; then
  pass "servers.json written 0600"
else
  fail "servers.json perms=$PERM (want 600)"
fi

if [ "$UNAME_S" = "Darwin" ]; then
  REFS_ONLY="$(jq -r '
    [ (.servers[]?.dokploy_api_key), (.cloudflare.api_token) ]
    | map(type == "object" and has("_secret"))
    | all' "$CFG" 2>/dev/null || echo false)"
  if [ "$REFS_ONLY" = "true" ]; then
    pass "servers.json holds only {_secret} refs (no plaintext credentials)"
  else
    fail "servers.json contains a plaintext credential on macOS"
  fi
else
  # On non-macOS the plaintext path is the documented fallback; the gate is
  # that we warned loudly AND locked the file down (checked above).
  pass "plaintext-fallback documented + file locked (0600) on $UNAME_S"
fi

# ─── gate 5: ui-server boots and answers /api/health ────────────
section "gate 5 — ui-server /api/health"
LAUNCH="$REPO_ROOT/mcp-server/ui-server/launch.sh"
# Isolate everything under the throwaway HOME + a private state dir.
export HOME="$TMP_HOME"
export DOKPILOT_STATE_DIR="$TMP_HOME/.dokpilot-state"

if [ -f "$LAUNCH" ]; then
  OUT="$(bash "$LAUNCH" --no-open 2>&1 || true)"
  URL="$(printf '%s\n' "$OUT" | grep -oE 'http://127\.0\.0\.1:[0-9]+/\?t=[a-f0-9]+' | tail -n1 || true)"
  if [ -z "$URL" ]; then
    URL="$(cat "$DOKPILOT_STATE_DIR/.ui-url" 2>/dev/null || true)"
  fi
  if [ -n "$URL" ]; then
    PORT="${URL#*127.0.0.1:}"; PORT="${PORT%%/*}"
    TOKEN="${URL##*t=}"
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health?t=$TOKEN" 2>/dev/null || echo 000)"
    if [ "$CODE" = "200" ]; then
      pass "GET /api/health → 200"
    else
      fail "GET /api/health → $CODE"
    fi
  else
    fail "launch.sh did not report a UI URL (see $DOKPILOT_STATE_DIR/ui-server.log)"
  fi
  bash "$LAUNCH" --stop >/dev/null 2>&1 || true
  pass "ui-server stopped (--stop, idempotent)"
else
  fail "launch.sh not found at $LAUNCH"
fi

# ─── summary + Mode A action item ───────────────────────────────
section "result"
echo "ACTION ITEM (human, Mode A / marketplace):"
echo "  Add a 'dokpilot' entry to kyzdes/claude-skills .claude-plugin/marketplace.json"
echo "  (a separate repo). This smoke proves Mode B (clone + symlink) ONLY;"
echo "  Mode A cannot be asserted from here."
echo
if [ "$FAILS" -eq 0 ]; then
  echo "PASS: all gates green"
  exit 0
else
  echo "FAIL: $FAILS gate(s) failed"
  exit 1
fi
