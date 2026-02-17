#!/bin/bash
# Dokploy REST API wrapper
# Usage: dokploy-api.sh <server-name> <HTTP-method> <endpoint> [json-body]
#
# Examples:
#   dokploy-api.sh main GET project.all
#   dokploy-api.sh main POST project.create '{"name":"my-app"}'
#   dokploy-api.sh main POST application.deploy '{"applicationId":"abc123"}'
#
# Reads credentials from config/servers.json (relative to script location)
# Returns: JSON response from Dokploy API
# Exit codes: 0 = success, 1 = config error, 2 = HTTP error, 3 = network error

set -euo pipefail

SERVER="${1:?Usage: dokploy-api.sh <server> <method> <endpoint> [body]}"
METHOD="${2:?Missing HTTP method}"
ENDPOINT="${3:?Missing API endpoint}"
BODY="${4:-}"

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/../config/servers.json"

if [ ! -f "$CONFIG" ]; then
  echo '{"error": "Config not found. Run: /vps config server add <name> <ip>"}' >&2
  exit 1
fi

URL=$(jq -r ".servers.\"$SERVER\".dokploy_url // empty" "$CONFIG")
KEY=$(jq -r ".servers.\"$SERVER\".dokploy_api_key // empty" "$CONFIG")

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "{\"error\": \"Server '$SERVER' not found or missing API key\"}" >&2
  exit 1
fi

CURL_ARGS=(
  -s -S
  --max-time 30
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

if [ "$HTTP_CODE" -ge 400 ] 2>/dev/null; then
  echo "$BODY_RESP" >&2
  exit 2
fi

echo "$BODY_RESP"
