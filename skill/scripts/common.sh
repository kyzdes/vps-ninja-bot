#!/bin/bash
# common.sh — Shared utilities for VPS Ninja scripts
# Source this file at the beginning of each script:
#   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#
# Provides:
#   - Config loading and validation
#   - Structured error handling with JSON output
#   - Logging (info, warn, error, debug)
#   - Smart retry with idempotency awareness
#   - Input sanitization and validation
#   - Remote execution helpers
#   - Cleanup trap (safe, no eval)

set -euo pipefail

# ── Colors (disabled when not a terminal) ──

if [ -t 2 ]; then
  _RED='\033[0;31m' _YELLOW='\033[0;33m' _GREEN='\033[0;32m'
  _CYAN='\033[0;36m' _DIM='\033[2m' _RESET='\033[0m'
else
  _RED='' _YELLOW='' _GREEN='' _CYAN='' _DIM='' _RESET=''
fi

# ── Logging ──

VPS_DEBUG="${VPS_DEBUG:-}"
VPS_QUIET="${VPS_QUIET:-}"

log_info()  { [ -z "$VPS_QUIET" ] && echo -e "${_GREEN}[INFO]${_RESET} $*" >&2 || true; }
log_warn()  { echo -e "${_YELLOW}[WARN]${_RESET} $*" >&2; }
log_error() { echo -e "${_RED}[ERROR]${_RESET} $*" >&2; }
log_debug() { [ -n "$VPS_DEBUG" ] && echo -e "${_DIM}[DEBUG]${_RESET} $*" >&2 || true; }

# ── Error handling (JSON-safe via jq) ──

# Output structured JSON error and exit
# Usage: die "message" [exit_code]
die() {
  local msg="${1:-Unknown error}" code="${2:-1}"
  if command -v jq &>/dev/null; then
    jq -n --arg msg "$msg" '{"error": $msg}' >&2
  else
    echo "{\"error\": \"$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')\"}" >&2
  fi
  exit "$code"
}

# Output structured JSON error with details
# Usage: die_detail "message" "details" [exit_code]
die_detail() {
  local msg="${1:-Unknown error}" details="${2:-}" code="${3:-1}"
  if command -v jq &>/dev/null; then
    jq -n --arg msg "$msg" --arg details "$details" '{"error": $msg, "details": $details}' >&2
  else
    echo "{\"error\": \"$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')\"}" >&2
  fi
  exit "$code"
}

# Build JSON safely using jq
# Usage: json_obj key1 val1 key2 val2 ...
json_obj() {
  local args=()
  while [ $# -ge 2 ]; do
    args+=(--arg "$1" "$2")
    shift 2
  done
  jq -n "${args[@]}" '$ARGS.named'
}

# ── Config management ──

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"
CONFIG_PATH="${VPS_CONFIG:-$SCRIPT_DIR/../config/servers.json}"

# Load and validate config file
# Sets: CONFIG_PATH (verified to exist)
require_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    die "Config not found at $CONFIG_PATH. Run: /vps config server add <name> <ip>" 1
  fi
  # Validate JSON syntax
  if ! jq empty "$CONFIG_PATH" 2>/dev/null; then
    die "Config file is not valid JSON: $CONFIG_PATH" 1
  fi
  log_debug "Config loaded: $CONFIG_PATH"
}

# Read a value from config with jq
# Usage: config_get '.servers."main".host'
# Returns: value or empty string (never fails with set -e)
config_get() {
  local query="$1"
  local result
  result=$(jq -r "$query // empty" "$CONFIG_PATH" 2>/dev/null) || result=""
  echo "$result"
}

# Get server config values
# Usage: require_server "main"
# Sets: SERVER_HOST, SERVER_USER, SERVER_SSH_KEY, SERVER_DOKPLOY_URL, SERVER_DOKPLOY_KEY
require_server() {
  local server="${1:?Server name required}"
  require_config

  SERVER_HOST=$(config_get ".servers.\"$server\".host")
  SERVER_USER=$(config_get ".servers.\"$server\".ssh_user")
  SERVER_SSH_KEY=$(config_get ".servers.\"$server\".ssh_key")
  SERVER_DOKPLOY_URL=$(config_get ".servers.\"$server\".dokploy_url")
  SERVER_DOKPLOY_KEY=$(config_get ".servers.\"$server\".dokploy_api_key")

  [ -z "$SERVER_HOST" ] && die "Server '$server' not found in config" 1
  [ -z "$SERVER_USER" ] && SERVER_USER="root"

  log_debug "Server '$server': host=$SERVER_HOST user=$SERVER_USER"
}

# Get CloudFlare token
# Usage: require_cloudflare
# Sets: CF_TOKEN
require_cloudflare() {
  require_config
  CF_TOKEN=$(config_get ".cloudflare.api_token")
  [ -z "$CF_TOKEN" ] && die "CloudFlare token not configured. Run: /vps config cloudflare <token>" 1
  log_debug "CloudFlare token loaded (${#CF_TOKEN} chars)"
}

# Get default server name
# Usage: get_default_server
get_default_server() {
  require_config
  local server
  server=$(config_get ".defaults.server")
  [ -z "$server" ] && server="main"
  echo "$server"
}

# Get settings with defaults
# Usage: get_setting "timeout_deploy" "600"
get_setting() {
  local key="$1" default="${2:-}"
  require_config
  local val
  val=$(config_get ".settings.$key")
  echo "${val:-$default}"
}

# ── Smart retry ──

# Retry a command with exponential backoff
# Usage: retry [--max N] [--delay SECS] [--idempotent] -- command args...
# --idempotent: allow retry (default: no retry for safety)
# --max: max attempts (default: 3)
# --delay: initial delay in seconds (default: 2)
retry() {
  local max=3 delay=2 idempotent=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --max) max="$2"; shift 2 ;;
      --delay) delay="$2"; shift 2 ;;
      --idempotent) idempotent=true; shift ;;
      --) shift; break ;;
      *) break ;;
    esac
  done

  if [ "$idempotent" = false ]; then
    # Non-idempotent: just run once
    "$@"
    return $?
  fi

  local attempt=1 current_delay=$delay
  while [ $attempt -le $max ]; do
    log_debug "Attempt $attempt/$max: $*"
    if "$@"; then
      return 0
    fi
    local exit_code=$?
    if [ $attempt -eq $max ]; then
      log_error "All $max attempts failed"
      return $exit_code
    fi
    log_warn "Attempt $attempt failed (exit $exit_code), retrying in ${current_delay}s..."
    sleep "$current_delay"
    current_delay=$((current_delay * 2))
    attempt=$((attempt + 1))
  done
}

# ── Input sanitization ──

# Sanitize string for safe use in JSON values (use jq when possible)
# Usage: sanitize_json "user input"
sanitize_json() {
  local input="$1"
  if command -v jq &>/dev/null; then
    printf '%s' "$input" | jq -Rs .
  else
    # Fallback: escape backslash, double-quote, control chars
    printf '%s' "$input" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr -d '\000-\010\013\014\016-\037'
  fi
}

# ── Input validation ──

# Validate IP address format (checks each octet is 0-255)
# Usage: validate_ip "1.2.3.4" || die "Invalid IP"
validate_ip() {
  local ip="$1"
  [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  local IFS='.'
  read -ra octets <<< "$ip"
  for octet in "${octets[@]}"; do
    (( octet > 255 )) && return 1
  done
  return 0
}

# Validate domain format
# Usage: validate_domain "app.example.com" || die "Invalid domain"
validate_domain() {
  local domain="$1"
  [[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$ ]]
}

# Validate that a string is a positive integer
# Usage: validate_int "42" || die "Expected integer"
validate_int() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

# Validate name (alphanumeric, hyphens, underscores only)
# Usage: validate_name "my-app" || die "Invalid name"
validate_name() {
  [[ "${1:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]
}

# Shell-escape a string for safe interpolation into remote commands
# Usage: escaped=$(shell_escape "$user_input")
shell_escape() {
  printf '%q' "$1"
}

# ── Domain utilities ──

# Known second-level TLDs (multi-part TLDs)
MULTI_TLDS="co.uk|org.uk|ac.uk|gov.uk|com.au|net.au|org.au|com.br|net.br|org.br|co.jp|or.jp|ne.jp|co.kr|or.kr|com.cn|net.cn|org.cn|co.nz|net.nz|org.nz|co.za|org.za|co.in|net.in|org.in|com.mx|org.mx|com.ar|com.ua|co.il|com.sg|com.hk|co.th|com.my|com.ph|com.tw|com.tr|com.pl|com.ro|co.ke"

# Extract zone domain from full domain, handling multi-TLDs
# Usage: get_zone_domain "app.example.com"      → "example.com"
# Usage: get_zone_domain "app.example.co.uk"     → "example.co.uk"
get_zone_domain() {
  local domain="$1"

  # Check for known multi-part TLDs
  local tld
  for tld in $(echo "$MULTI_TLDS" | tr '|' ' '); do
    if [[ "$domain" == *".$tld" ]]; then
      local without_tld="${domain%."$tld"}"
      local base="${without_tld##*.}"
      echo "${base}.${tld}"
      return 0
    fi
  done

  # Default: last two parts
  echo "$domain" | awk -F. '{print $(NF-1)"."$NF}'
}

# ── Mask secrets in output ──

# Mask a sensitive string for display
# Usage: mask_secret "api_key_12345" → "api***"
mask_secret() {
  local val="$1"
  local len=${#val}
  if [ "$len" -le 8 ]; then
    echo "***"
  elif [ "$len" -le 20 ]; then
    echo "${val:0:2}***"
  else
    echo "${val:0:3}***${val: -3}"
  fi
}

# ── Cleanup trap (safe, no eval) ──

_CLEANUP_FUNCS=()

# Register a cleanup function name to run on exit
# IMPORTANT: only pass function names, not arbitrary strings
# Usage: on_cleanup my_cleanup_function
on_cleanup() {
  _CLEANUP_FUNCS+=("$1")
}

_run_cleanup() {
  for fn in "${_CLEANUP_FUNCS[@]:-}"; do
    if declare -F "$fn" &>/dev/null; then
      "$fn" 2>/dev/null || true
    else
      log_debug "Cleanup: '$fn' is not a function, skipping"
    fi
  done
}
trap _run_cleanup EXIT

# ── Remote execution (shared helper) ──

# Execute a command on a remote server via ssh-exec.sh
# Usage: run_remote_cmd <server-name> <command>
# Requires: SERVER_HOST, SERVER_USER, SERVER_SSH_KEY to be set (via require_server)
run_remote_cmd() {
  local server="$1" cmd="$2"
  bash "${SCRIPT_DIR}/ssh-exec.sh" "$server" "$cmd"
}

# ── Atomic file write ──

# Write content to a file atomically (write to temp, then rename)
# Usage: echo "$content" | atomic_write "/path/to/file"
atomic_write() {
  local target="$1"
  local tmpfile
  tmpfile=$(mktemp "${target}.XXXXXX")
  if cat > "$tmpfile" && mv "$tmpfile" "$target"; then
    return 0
  else
    rm -f "$tmpfile" 2>/dev/null
    return 1
  fi
}

# ── Dependency checks ──

# Check if required commands are available
# Usage: require_cmd jq curl sshpass
require_cmd() {
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      die "$cmd is not installed. Install it first." 1
    fi
  done
}

log_debug "common.sh loaded from $SCRIPT_DIR"
