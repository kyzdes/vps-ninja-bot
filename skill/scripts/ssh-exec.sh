#!/bin/bash
# SSH command execution wrapper
# Usage: ssh-exec.sh <server-name> <command>
#        ssh-exec.sh --password <pass> <ip> <command>
#        ssh-exec.sh --password <pass> <ip> --upload <local-file> <remote-path>
#
# Examples:
#   ssh-exec.sh main "uname -a"
#   ssh-exec.sh main "docker ps"
#   ssh-exec.sh --password MyPass123 45.55.67.89 "apt update"
#   ssh-exec.sh main --upload ./setup.sh /tmp/setup.sh
#
# Reads SSH credentials from config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = SSH error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# SSH options as array (safe, no word-splitting issues)
# accept-new: accept key on first connect, verify on subsequent (MITM protection)
SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o LogLevel=ERROR
)

# Global command timeout (seconds) — prevents hanging on long operations
CMD_TIMEOUT=$(get_setting "timeout_ssh" "600")

# Execute SSH command with timeout wrapper
run_ssh() {
  if command -v timeout &>/dev/null; then
    timeout "$CMD_TIMEOUT" "$@"
  else
    "$@"
  fi
}

# ── Password mode (for initial setup) ──

if [ "${1:-}" = "--password" ]; then
  PASSWORD="${2:?Missing password}"
  HOST="${3:?Missing host}"

  validate_ip "$HOST" || die "Invalid IP address: $HOST" 1
  require_cmd sshpass

  # Use SSHPASS env var instead of -p to avoid password in process listing
  export SSHPASS="$PASSWORD"

  # Upload mode
  if [ "${4:-}" = "--upload" ]; then
    LOCAL_FILE="${5:?Missing local file path}"
    REMOTE_PATH="${6:?Missing remote path}"
    [ ! -f "$LOCAL_FILE" ] && die "Local file not found: $LOCAL_FILE" 1

    log_info "Uploading $LOCAL_FILE → $HOST:$REMOTE_PATH"
    run_ssh sshpass -e scp "${SSH_OPTS[@]}" "$LOCAL_FILE" "root@${HOST}:${REMOTE_PATH}"
    exit $?
  fi

  # Command mode — properly quote the command to prevent injection
  CMD="${4:?Missing command}"
  log_debug "SSH (password) → root@$HOST: executing command"

  run_ssh sshpass -e ssh "${SSH_OPTS[@]}" "root@${HOST}" -- "$CMD"
  exit $?
fi

# ── Normal mode (from config) ──

SERVER="${1:?Usage: ssh-exec.sh <server-name> <command>}"

# Upload mode
if [ "${2:-}" = "--upload" ]; then
  LOCAL_FILE="${3:?Missing local file path}"
  REMOTE_PATH="${4:?Missing remote path}"

  require_server "$SERVER"
  [ ! -f "$LOCAL_FILE" ] && die "Local file not found: $LOCAL_FILE" 1

  log_info "Uploading $LOCAL_FILE → $SERVER_HOST:$REMOTE_PATH"
  if [ -n "$SERVER_SSH_KEY" ] && [ "$SERVER_SSH_KEY" != "null" ]; then
    run_ssh scp "${SSH_OPTS[@]}" -i "$SERVER_SSH_KEY" "$LOCAL_FILE" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_PATH}"
  else
    run_ssh scp "${SSH_OPTS[@]}" "$LOCAL_FILE" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_PATH}"
  fi
  exit $?
fi

# Command mode
CMD="${2:?Missing command}"

require_server "$SERVER"
log_debug "SSH → ${SERVER_USER}@${SERVER_HOST}: executing command"

if [ -n "$SERVER_SSH_KEY" ] && [ "$SERVER_SSH_KEY" != "null" ]; then
  run_ssh ssh "${SSH_OPTS[@]}" -i "$SERVER_SSH_KEY" "${SERVER_USER}@${SERVER_HOST}" -- "$CMD"
else
  run_ssh ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" -- "$CMD"
fi
