#!/bin/bash
# Dokploy REST API wrapper
# Usage: dokploy-api.sh [--extract <jq-path>] <server-name> <HTTP-method> <endpoint> [json-body]
#
# Examples:
#   dokploy-api.sh main GET project.all
#   dokploy-api.sh main POST project.create '{"name":"my-app"}'
#   dokploy-api.sh main POST application.deploy '{"applicationId":"abc123"}'
#   dokploy-api.sh --extract '.project.projectId' main POST project.create '{"name":"my-app"}'
#
# Options:
#   --extract <jq-path>  Extract a specific field from the JSON response using jq
#                         Example: --extract '.project.projectId'
#                         Example: --extract '.environment.environmentId'
#
# Reads credentials from config/servers.json (relative to script location)
# Returns: JSON response from Dokploy API (or extracted field if --extract is used)
# Exit codes: 0 = success, 1 = config error, 2 = HTTP error, 3 = network error, 4 = invalid JSON response
#
# Security note: The API key is passed via -H header on the command line, which is
# briefly visible in `ps` output. This is acceptable for a short-lived CLI tool.
# For production automation, consider using a secrets manager or --header @- with heredoc.

set -euo pipefail

# Parse optional --extract flag
EXTRACT_PATH=""
if [ "${1:-}" = "--extract" ]; then
  EXTRACT_PATH="${2:?Missing jq path after --extract}"
  shift 2
fi

SERVER="${1:?Usage: dokploy-api.sh [--extract <jq-path>] <server> <method> <endpoint> [body]}"
METHOD="${2:?Missing HTTP method}"
ENDPOINT="${3:?Missing API endpoint}"
BODY="${4:-}"

# ── Destroy safety gate (defense-in-depth) ─────────────────────────────────
# The highest-blast-radius deletions (a whole project, or an app/compose) are
# REFUSED unless the caller explicitly sets DOKPILOT_CONFIRM_DESTROY=1. The skill
# sets it ONLY after the user types the resource name back (SKILL.md → DESTROY
# SAFETY GATE); the dashboard sets it after its own typed-confirm UI. This stops
# a model-invoked skill from nuking a project without explicit human intent.
case "$ENDPOINT" in
  project.remove|application.delete|compose.delete)
    if [ "${DOKPILOT_CONFIRM_DESTROY:-}" != "1" ]; then
      echo "{\"error\": \"destroy-blocked\", \"endpoint\": \"$ENDPOINT\", \"hint\": \"Refusing an irreversible delete. Confirm intent with the user (have them type the exact resource name), THEN set DOKPILOT_CONFIRM_DESTROY=1 for this one call. See SKILL.md DESTROY SAFETY GATE.\"}" >&2
      exit 3
    fi
    ;;
esac

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/../config/servers.json"

if [ ! -f "$CONFIG" ]; then
  echo '{"error": "Config not found. Run: /vps config server add <name> <ip>"}' >&2
  exit 1
fi

# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

URL=$(jq -r ".servers.\"$SERVER\".dokploy_url // empty" "$CONFIG")
if ! KEY=$(resolve_secret ".servers.\"$SERVER\".dokploy_api_key"); then
  KEY=""
fi

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "{\"error\": \"Server '$SERVER' not found or missing API key\"}" >&2
  exit 1
fi

# Dynamic timeout — longer for mutation endpoints that may take time
MAX_TIME=30
if echo "$ENDPOINT" | grep -qE 'update|deploy|saveBuildType|saveEnvironment|saveGithubProvider|remove|delete'; then
  MAX_TIME=60
fi

CURL_ARGS=(
  -s -S
  --max-time "$MAX_TIME"
  --retry 2
  --retry-delay 3
  -X "$METHOD"
  -H "Content-Type: application/json"
  -H "x-api-key: $KEY"
  -w "\n%{http_code}"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

RESPONSE=$(curl "${CURL_ARGS[@]}" "${URL}/api/${ENDPOINT}" 2>&1) || {
  echo "{\"error\": \"Network error connecting to $URL\"}" >&2
  exit 3
}

# Separate HTTP code from body
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESP=$(echo "$RESPONSE" | sed '$d')

# Handle HTTP errors with informative output
if [ "$HTTP_CODE" -ge 400 ] 2>/dev/null; then
  # Parse tRPC/Zod validation errors for clearer messages
  if echo "$BODY_RESP" | jq -e '.data.zodError.fieldErrors' >/dev/null 2>&1; then
    FIELD_ERRORS=$(echo "$BODY_RESP" | jq -r '.data.zodError.fieldErrors | to_entries | map("\(.key): \(.value[0])") | join(", ")' 2>/dev/null)
    echo "{\"error\": \"Validation error: $FIELD_ERRORS\", \"hint\": \"Check required fields in API reference\", \"endpoint\": \"$ENDPOINT\"}" >&2
    exit 2
  fi

  # Try to extract error message from JSON response
  ERROR_MSG=""
  if echo "$BODY_RESP" | jq -e . >/dev/null 2>&1; then
    ERROR_MSG=$(echo "$BODY_RESP" | jq -r '.message // .error // empty' 2>/dev/null)
  fi

  if [ -n "$ERROR_MSG" ]; then
    echo "{\"error\": \"HTTP $HTTP_CODE: $ERROR_MSG\", \"endpoint\": \"$ENDPOINT\", \"body\": $BODY_RESP}" >&2
  else
    echo "{\"error\": \"HTTP $HTTP_CODE\", \"endpoint\": \"$ENDPOINT\", \"response\": $(echo "$BODY_RESP" | jq -Rs .)}" >&2
  fi
  exit 2
fi

# Validate JSON response (skip for empty responses or plain text)
if [ -n "$BODY_RESP" ]; then
  if ! echo "$BODY_RESP" | jq -e . >/dev/null 2>&1; then
    # Check if this is an expected non-JSON response (e.g., deployment logs)
    if echo "$ENDPOINT" | grep -qE 'logs|version'; then
      # Plain text is OK for log endpoints
      echo "$BODY_RESP"
      exit 0
    else
      echo "{\"error\": \"Invalid JSON response from $ENDPOINT\", \"raw\": $(echo "$BODY_RESP" | head -5 | jq -Rs .)}" >&2
      exit 4
    fi
  fi
fi

# Extract specific field if --extract was provided
if [ -n "$EXTRACT_PATH" ]; then
  EXTRACTED=$(echo "$BODY_RESP" | jq -r "$EXTRACT_PATH // empty" 2>/dev/null)
  if [ -z "$EXTRACTED" ]; then
    echo "{\"error\": \"Could not extract '$EXTRACT_PATH' from response\", \"response\": $BODY_RESP}" >&2
    exit 4
  fi
  echo "$EXTRACTED"
else
  echo "$BODY_RESP"
fi
