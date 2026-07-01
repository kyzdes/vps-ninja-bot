#!/bin/bash
# SSH command execution wrapper
# Usage: ssh-exec.sh <server-name> <command>
#        ssh-exec.sh --password <pass> <ip> <command>
#        ssh-exec.sh --bg <server-name> <command> [log-file]
#        ssh-exec.sh --poll <server-name> <process-pattern> [log-file]
#        ssh-exec.sh --selftest
#
# Examples:
#   ssh-exec.sh main "uname -a"
#   ssh-exec.sh main "docker ps"
#   ssh-exec.sh main "free -h && df -h"
#   ssh-exec.sh --password MyPass123 203.0.113.10 "apt update"
#   ssh-exec.sh --bg main "docker build -t app ." "/tmp/build.log"
#   ssh-exec.sh --poll main "docker build" "/tmp/build.log"
#
# Reads SSH credentials from config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = SSH error

set -euo pipefail

# --- SSH host-key policy: TOFU (trust-on-first-use) ---
# StrictHostKeyChecking=accept-new pins each server's host key on the FIRST
# connection into a per-skill known_hosts file, then refuses to connect if the
# key later changes — which is how a man-in-the-middle attack gets detected.
# (The old StrictHostKeyChecking=no + UserKnownHostsFile=/dev/null combination
# disabled this entirely and silently trusted whatever key answered on every
# connect, so a MITM was undetectable.)
#
# ROTATED HOST KEY: if a VPS is legitimately reinstalled/reimaged its host key
# changes and SSH will refuse to connect ("REMOTE HOST IDENTIFICATION HAS
# CHANGED"). Clear the stale pin, then reconnect to re-pin the new key:
#     ssh-keygen -R <host> -f "<config-dir>/known_hosts"
# The default <config-dir> is skills/dokpilot/config (override the whole path
# with the DOKPILOT_KNOWN_HOSTS env var). This file records server IPs, so it
# is gitignored — never commit it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KNOWN_HOSTS_FILE="${DOKPILOT_KNOWN_HOSTS:-$SCRIPT_DIR/../config/known_hosts}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN_HOSTS_FILE -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o LogLevel=ERROR"

# --- Helper functions ---

# Ensure the per-skill known_hosts file (and its directory) exist with tight
# permissions before ssh tries to pin/read a host key. Dir 0700, file 0600.
_ensure_known_hosts() {
  local dir
  dir="$(dirname "$KNOWN_HOSTS_FILE")"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    chmod 700 "$dir"
  fi
  if [ ! -f "$KNOWN_HOSTS_FILE" ]; then
    : > "$KNOWN_HOSTS_FILE"
    chmod 600 "$KNOWN_HOSTS_FILE"
  fi
}

# Load server config from servers.json. Sets HOST, USER, SSH_KEY globals.
_load_server_config() {
  local server_name="$1"
  local script_dir; script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local config="$script_dir/../config/servers.json"

  if [ ! -f "$config" ]; then
    echo '{"error": "Config not found. Run: /dokpilot config server add <name> <ip>"}' >&2
    exit 1
  fi

  HOST=$(jq -r ".servers.\"$server_name\".host // empty" "$config")
  USER=$(jq -r ".servers.\"$server_name\".ssh_user // \"root\"" "$config")
  SSH_KEY=$(jq -r ".servers.\"$server_name\".ssh_key // empty" "$config")

  if [ -z "$HOST" ]; then
    echo "{\"error\": \"Server '$server_name' not found in config\"}" >&2
    exit 1
  fi
}

# Run SSH command, handling SSH_KEY presence automatically.
_run_ssh() {
  local cmd="$1"
  _ensure_known_hosts
  if [ -n "$SSH_KEY" ] && [ "$SSH_KEY" != "null" ]; then
    ssh $SSH_OPTS -i "$SSH_KEY" "${USER}@${HOST}" "$cmd"
  else
    ssh $SSH_OPTS "${USER}@${HOST}" "$cmd"
  fi
}

# Escape single quotes for safe interpolation into sh -c '...' strings.
# The /g flag is REQUIRED: without it only the first quote per line is escaped,
# leaving every later quote able to break out of the surrounding '...'.
_escape_for_sh() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

# --- Modes ---

# Selftest mode — round-trip strings through _escape_for_sh and assert that,
# once wrapped in the surrounding '...', a real shell re-parses them back to
# the exact original bytes. Catches regressions like a missing sed /g flag.
if [ "${1:-}" = "--selftest" ]; then
  _st_fails=0
  _st_roundtrip() {
    local input="$1" desc="$2" escaped got
    escaped=$(_escape_for_sh "$input")
    # Wrap the escaped payload in single quotes exactly as --bg/--poll do,
    # then let a fresh shell re-parse it and echo the argument back verbatim.
    got=$(sh -c "printf '%s' '${escaped}'")
    if [ "$got" = "$input" ]; then
      printf 'ok   [%s]\n' "$desc"
    else
      printf 'FAIL [%s]: input=%q escaped=%q got=%q\n' "$desc" "$input" "$escaped" "$got" >&2
      _st_fails=$((_st_fails + 1))
    fi
  }
  _st_roundtrip "no quotes at all"                 "plain"
  _st_roundtrip "it's a 'test' with 'many' quotes" "multi-quote"
  _st_roundtrip "trailing single quote'"           "trailing-quote"
  _st_roundtrip "'leading single quote"            "leading-quote"
  _st_roundtrip "''''"                             "only-quotes"
  _st_roundtrip ""                                 "empty-string"
  _st_roundtrip "mix'ed \"double\" and 'single'"   "mixed-quotes"
  if [ "$_st_fails" -ne 0 ]; then
    echo "selftest: $_st_fails failure(s)" >&2
    exit 1
  fi
  echo "selftest: all passed"
  exit 0
fi

# Password mode (for initial setup when server is not in config yet)
# Note: uses SSHPASS env var instead of -p flag to avoid password in ps output
if [ "${1:-}" = "--password" ]; then
  PASSWORD="${2:?Missing password}"
  HOST="${3:?Missing host}"
  CMD="${4:?Missing command}"

  if ! command -v sshpass &> /dev/null; then
    echo '{"error": "sshpass not installed. Install: apt install sshpass / brew install sshpass"}' >&2
    exit 1
  fi

  _ensure_known_hosts
  export SSHPASS="$PASSWORD"
  sshpass -e ssh $SSH_OPTS "root@${HOST}" "$CMD"
  EXIT_CODE=$?
  unset SSHPASS
  exit $EXIT_CODE
fi

# Background mode — run long commands without SSH timeout
# Usage: ssh-exec.sh --bg <server-name> <command> [log-file]
if [ "${1:-}" = "--bg" ]; then
  shift
  SERVER="${1:?Usage: ssh-exec.sh --bg <server-name> <command> [log-file]}"
  CMD="${2:?Missing command}"
  LOG_FILE="${3:-/tmp/dokpilot-bg-$(date +%s).log}"

  _load_server_config "$SERVER"

  ESCAPED_CMD=$(_escape_for_sh "$CMD")
  SSH_CMD="nohup sh -c '${ESCAPED_CMD}' > ${LOG_FILE} 2>&1 & echo \$!"
  PID=$(_run_ssh "$SSH_CMD")

  echo "{\"status\": \"started\", \"pid\": \"$PID\", \"log_file\": \"${LOG_FILE}\"}"
  exit 0
fi

# Poll mode — check if a background process is still running
# Usage: ssh-exec.sh --poll <server-name> <process-pattern> [log-file]
if [ "${1:-}" = "--poll" ]; then
  shift
  SERVER="${1:?Usage: ssh-exec.sh --poll <server-name> <process-pattern> [log-file]}"
  PATTERN="${2:?Missing process pattern}"
  LOG_FILE="${3:-}"

  _load_server_config "$SERVER"

  ESCAPED_PATTERN=$(_escape_for_sh "$PATTERN")
  CHECK_CMD="pgrep -f '${ESCAPED_PATTERN}' > /dev/null 2>&1 && echo running || echo done"
  STATUS=$(_run_ssh "$CHECK_CMD")

  if [ "$STATUS" = "done" ] && [ -n "$LOG_FILE" ]; then
    TAIL=$(_run_ssh "tail -20 ${LOG_FILE} 2>/dev/null || echo 'Log not found'")
    echo "{\"status\": \"done\", \"log_tail\": $(echo "$TAIL" | jq -Rs .)}"
  else
    echo "{\"status\": \"$STATUS\"}"
  fi
  exit 0
fi

# Normal mode — read from config
SERVER="${1:?Usage: ssh-exec.sh <server-name> <command>}"
CMD="${2:?Missing command}"

_load_server_config "$SERVER"
_run_ssh "$CMD"
