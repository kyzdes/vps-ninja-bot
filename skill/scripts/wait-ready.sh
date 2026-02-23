#!/bin/bash
# Wait for a URL to become accessible with progress output
# Usage: wait-ready.sh <url> [timeout_seconds] [interval_seconds]
#
# Examples:
#   wait-ready.sh http://45.55.67.89:3000 180
#   wait-ready.sh https://app.example.com 120 5
#
# Exit codes: 0 = ready, 1 = timeout

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

URL="${1:?Usage: wait-ready.sh <url> [timeout] [interval]}"
TIMEOUT="${2:-120}"
INTERVAL="${3:-5}"

log_info "Waiting for $URL (timeout: ${TIMEOUT}s, interval: ${INTERVAL}s)"

ELAPSED=0
ATTEMPT=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" 2>/dev/null || echo "000")

  # Consider 2xx and 3xx as success, 4xx means app is running (just not this route)
  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
    log_info "Ready! HTTP $HTTP_CODE after ${ELAPSED}s (${ATTEMPT} attempts)"
    echo "{\"status\": \"ready\", \"url\": \"$URL\", \"http_code\": $HTTP_CODE, \"elapsed\": $ELAPSED, \"attempts\": $ATTEMPT}"
    exit 0
  fi

  # Progress output every 3rd attempt
  if [ $((ATTEMPT % 3)) -eq 0 ]; then
    log_info "Still waiting... HTTP $HTTP_CODE (${ELAPSED}s/${TIMEOUT}s)"
  else
    log_debug "Attempt $ATTEMPT: HTTP $HTTP_CODE"
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

log_error "Timeout after ${TIMEOUT}s waiting for $URL"
echo "{\"status\": \"timeout\", \"url\": \"$URL\", \"timeout\": $TIMEOUT, \"attempts\": $ATTEMPT, \"last_code\": \"$HTTP_CODE\"}" >&2
exit 1
