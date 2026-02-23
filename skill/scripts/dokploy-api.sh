#!/bin/bash
# Dokploy REST API wrapper
# Usage: dokploy-api.sh <server-name> <HTTP-method> <endpoint> [json-body]
#
# Examples:
#   dokploy-api.sh main GET project.all
#   dokploy-api.sh main POST project.create '{"name":"my-app"}'
#   dokploy-api.sh main POST application.deploy '{"applicationId":"abc123"}'
#
# Reads credentials from config/servers.json
# Returns: JSON response from Dokploy API
# Exit codes: 0 = success, 1 = config error, 2 = HTTP error, 3 = network error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq curl

SERVER="${1:?Usage: dokploy-api.sh <server> <method> <endpoint> [body]}"
METHOD="${2:?Missing HTTP method}"
ENDPOINT="${3:?Missing API endpoint}"
BODY="${4:-}"

# Load server config
require_server "$SERVER"

[ -z "$SERVER_DOKPLOY_URL" ] && die "Dokploy URL not configured for server '$SERVER'" 1
[ -z "$SERVER_DOKPLOY_KEY" ] && die "Dokploy API key not configured for server '$SERVER'" 1

URL="$SERVER_DOKPLOY_URL"
KEY="$SERVER_DOKPLOY_KEY"

# Determine timeout from settings
TIMEOUT=$(get_setting "timeout_api" "30")

# Determine if this request is safe to retry (idempotent)
IDEMPOTENT=false
case "$METHOD" in
  GET|HEAD|OPTIONS) IDEMPOTENT=true ;;
esac

log_debug "API call: $METHOD /api/$ENDPOINT (idempotent=$IDEMPOTENT)"

# Build curl arguments
do_request() {
  local curl_args=(
    -s -S
    --max-time "$TIMEOUT"
    -X "$METHOD"
    -H "Content-Type: application/json"
    -H "x-api-key: $KEY"
    -w "\n%{http_code}"
  )

  if [ -n "$BODY" ]; then
    curl_args+=(-d "$BODY")
    log_debug "Request body: $BODY"
  fi

  local response
  response=$(curl "${curl_args[@]}" "${URL}/api/${ENDPOINT}" 2>&1) || {
    log_error "Network error connecting to $URL"
    return 3
  }

  # Separate HTTP code from body
  local http_code body_resp
  http_code=$(echo "$response" | tail -1)
  body_resp=$(echo "$response" | sed '$d')

  log_debug "HTTP $http_code from $ENDPOINT"

  # Validate HTTP code is numeric
  if ! [[ "$http_code" =~ ^[0-9]+$ ]]; then
    log_error "Invalid HTTP response from $URL"
    echo "{\"error\": \"Invalid HTTP response\", \"raw\": \"$(sanitize_json "$body_resp")\"}" >&2
    return 3
  fi

  if [ "$http_code" -ge 400 ]; then
    log_error "HTTP $http_code from $ENDPOINT"
    echo "$body_resp" >&2
    return 2
  fi

  # Validate response is valid JSON (if non-empty)
  if [ -n "$body_resp" ]; then
    if echo "$body_resp" | jq empty 2>/dev/null; then
      echo "$body_resp"
    else
      # Non-JSON response, wrap it
      log_warn "Non-JSON response from $ENDPOINT"
      echo "{\"raw\": \"$(sanitize_json "$body_resp")\"}"
    fi
  fi

  return 0
}

# Execute with smart retry
if [ "$IDEMPOTENT" = true ]; then
  retry --max 3 --delay 2 --idempotent -- do_request
else
  # Non-idempotent (POST/PUT/DELETE): no retry
  do_request
fi
