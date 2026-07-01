#!/usr/bin/env bash
# Dokpilot UI launcher (cross-platform, zero-dependency).
#
# Spawns ui-server/server.js in the background and reports its launch URL.
# The server prints its URL on stdout (--quiet mode); the launcher captures
# that stdout into a log file and polls the log for the URL, so it stays
# decoupled from wherever the server writes its own internal state files.
# The launcher then records .ui-pid/.ui-port/.ui-url under STATE_DIR for its
# own --status / --stop subcommands.
#
# Usage:
#   launch.sh              start server, open browser, exit
#   launch.sh --stop       kill the running server (if any)
#   launch.sh --status     print port/pid/url if alive
#   launch.sh --no-open    start but don't open the URL (CI / headless use)
#
# Environment:
#   DOKPILOT_STATE_DIR     where the launcher keeps its pid/port/url/log files.
#                          Default: $HOME/.dokpilot, unless the legacy
#                          $HOME/.claude/skills/dokpilot dir already exists
#                          (kept for back-compat with existing installs).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_JS="$SCRIPT_DIR/server.js"

# ─── state dir resolution (cross-platform, back-compat) ─────────
if [ -n "${DOKPILOT_STATE_DIR:-}" ]; then
  STATE_DIR="$DOKPILOT_STATE_DIR"
elif [ -d "${HOME}/.claude/skills/dokpilot" ]; then
  STATE_DIR="${HOME}/.claude/skills/dokpilot"   # legacy install — keep using it
else
  STATE_DIR="${HOME}/.dokpilot"
fi

PID_FILE="$STATE_DIR/.ui-pid"
PORT_FILE="$STATE_DIR/.ui-port"
URL_FILE="$STATE_DIR/.ui-url"
LOG_FILE="$STATE_DIR/ui-server.log"

mkdir -p "$STATE_DIR"

# ─── cross-platform "open a URL in the browser" ─────────────────
open_url() {
  local u="$1"
  case "$(uname)" in
    Darwin)
      command -v open >/dev/null 2>&1 && open "$u" >/dev/null 2>&1 && return 0 ;;
    *)
      command -v xdg-open >/dev/null 2>&1 && xdg-open "$u" >/dev/null 2>&1 && return 0 ;;
  esac
  # No opener available (headless Linux, etc.) — print for manual use.
  echo "Open this URL in your browser: $u"
}

# ─── subcommands ────────────────────────────────────────────────
if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "stopped pid=$pid"
    else
      echo "stale pid=$pid (process already gone)"
    fi
    rm -f "$PID_FILE" "$PORT_FILE" "$URL_FILE"
  else
    echo "not running"
  fi
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "running"
    echo "  pid:  $(cat "$PID_FILE")"
    echo "  port: $(cat "$PORT_FILE" 2>/dev/null || echo '?')"
    echo "  url:  $(cat "$URL_FILE" 2>/dev/null || echo '?')"
  else
    echo "not running"
  fi
  exit 0
fi

NO_OPEN=0
for a in "$@"; do
  [ "$a" = "--no-open" ] && NO_OPEN=1
done

# ─── ensure node available ──────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH. Install Node 20+ to run the dashboard." >&2
  exit 2
fi

# ─── if already running, just reopen ────────────────────────────
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  url="$(cat "$URL_FILE" 2>/dev/null || echo '')"
  echo "already running at ${url:-?}"
  if [ "$NO_OPEN" = "0" ] && [ -n "$url" ]; then
    open_url "$url"
  fi
  exit 0
fi

# ─── start ──────────────────────────────────────────────────────
# Remove any stale state files so --status/--stop reflect this run.
rm -f "$URL_FILE" "$PORT_FILE" "$PID_FILE"

# Remember where the log ends now, so we only scan lines THIS run appends
# (the server prints its launch URL to stdout, which we capture below).
log_mark=0
if [ -f "$LOG_FILE" ]; then
  log_mark="$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ')"
fi
: "${log_mark:=0}"

# Forward-compat: a future server.js may honor this to co-locate its own
# state; today the launcher does not depend on that (it parses stdout).
export DOKPILOT_STATE_DIR="$STATE_DIR"

# Run the server in --quiet mode so stdout is just the launch URL.
nohup node "$SERVER_JS" --port 0 --quiet \
  >>"$LOG_FILE" 2>>"$LOG_FILE" &
server_pid=$!

# Poll the captured stdout for the launch URL (works regardless of where
# the server writes its own state files). 8s ceiling.
url=""
deadline=$(($(date +%s) + 8))
while [ -z "$url" ]; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "error: ui-server exited during startup — check $LOG_FILE" >&2
    exit 3
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "error: ui-server did not report a URL within 8s — check $LOG_FILE" >&2
    kill "$server_pid" 2>/dev/null || true
    exit 3
  fi
  url="$(tail -n +"$((log_mark + 1))" "$LOG_FILE" 2>/dev/null \
        | grep -oE 'http://127\.0\.0\.1:[0-9]+/\?t=[a-f0-9]+' \
        | tail -n1 || true)"
  [ -z "$url" ] && sleep 0.1
done

port="${url#*127.0.0.1:}"
port="${port%%/*}"

# Persist our own state so --status/--stop work against STATE_DIR.
umask 077
printf '%s' "$server_pid" > "$PID_FILE"
printf '%s' "$port"       > "$PORT_FILE"
printf '%s' "$url"        > "$URL_FILE"

echo "Dokpilot UI live at: $url"
echo "  pid:  $server_pid"
echo "  log:  $LOG_FILE"
echo "  stop: /dokpilot ui --stop"

if [ "$NO_OPEN" = "0" ]; then
  open_url "$url"
fi
