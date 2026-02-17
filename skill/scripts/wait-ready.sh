#!/bin/bash
# Wait for a URL to become accessible
# Usage: wait-ready.sh <url> [timeout_seconds] [interval_seconds]
#
# Examples:
#   wait-ready.sh http://45.55.67.89:3000 180
#   wait-ready.sh https://app.example.com 120 5
#
# Exit codes: 0 = ready, 1 = timeout

set -euo pipefail

URL="${1:?Usage: wait-ready.sh <url> [timeout] [interval]}"
TIMEOUT="${2:-120}"
INTERVAL="${3:-5}"

ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" 2>/dev/null || echo "000")

  # Consider 2xx and 3xx as success, 4xx as accessible (app is running, just not this route)
  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
    echo "{\"status\": \"ready\", \"url\": \"$URL\", \"http_code\": $HTTP_CODE, \"elapsed\": $ELAPSED}"
    exit 0
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "{\"status\": \"timeout\", \"url\": \"$URL\", \"timeout\": $TIMEOUT}" >&2
exit 1
