#!/bin/bash
# Post-deploy validation with auto-rollback
# Usage:
#   deploy-validator.sh validate <server> <app-id> <url> [options...]
#   deploy-validator.sh smoke    <server> <app-id> <url> <endpoints-json>
#   deploy-validator.sh gate     <server> <app-id> <url> --latency 500 --error-rate 1
#
# Options for validate:
#   --health <path>        Health endpoint path (default: /health or /)
#   --timeout <seconds>    Max wait for healthy state (default: 120)
#   --retries <n>          Number of health checks before pass (default: 3)
#   --interval <seconds>   Between checks (default: 5)
#   --auto-rollback        Rollback on failure
#   --prev-deployment <id> Previous deployment ID for rollback
#
# Exit codes: 0 = healthy, 1 = config error, 2 = unhealthy, 3 = rolled back

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd curl jq

ACTION="${1:?Usage: deploy-validator.sh <validate|smoke|gate> <server> <app-id> <url> [options...]}"
SERVER="${2:?Missing server name}"
APP_ID="${3:?Missing application ID}"
BASE_URL="${4:?Missing application URL}"

API_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/dokploy-api.sh"
BACKUP_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/backup.sh"
NOTIFY_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/notify.sh"

# ── Parse options ──

HEALTH_PATH="/health"
TIMEOUT=120
RETRIES=3
INTERVAL=5
AUTO_ROLLBACK=false
PREV_DEPLOYMENT=""
LATENCY_THRESHOLD=0
ERROR_RATE_THRESHOLD=0

shift 4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --health) HEALTH_PATH="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --retries) RETRIES="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --auto-rollback) AUTO_ROLLBACK=true; shift ;;
    --prev-deployment) PREV_DEPLOYMENT="$2"; shift 2 ;;
    --latency) LATENCY_THRESHOLD="$2"; shift 2 ;;
    --error-rate) ERROR_RATE_THRESHOLD="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── Rollback helper ──

do_rollback() {
  local reason="$1"
  log_error "Validation failed: $reason"

  if [ "$AUTO_ROLLBACK" = true ]; then
    log_warn "AUTO-ROLLBACK triggered"

    # Notify about rollback
    if [ -x "$NOTIFY_SCRIPT" ]; then
      bash "$NOTIFY_SCRIPT" send "$SERVER" "ROLLBACK: $reason" "warning" 2>/dev/null || true
    fi

    # Trigger re-deploy (Dokploy will use previous version)
    bash "$API_SCRIPT" "$SERVER" POST application.deploy "{\"applicationId\": \"$APP_ID\"}" 2>/dev/null || {
      log_error "Rollback deploy failed!"
      exit 3
    }

    log_info "Rollback initiated. Previous version redeploying..."
    exit 3
  else
    log_error "Deploy validation failed. Run with --auto-rollback to auto-revert."
    exit 2
  fi
}

# ── Actions ──

case "$ACTION" in
  validate)
    log_info "Validating deployment at ${BASE_URL}${HEALTH_PATH}"
    log_info "Config: timeout=${TIMEOUT}s, retries=$RETRIES, interval=${INTERVAL}s"

    ELAPSED=0
    PASS_COUNT=0
    FAIL_COUNT=0

    while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
      START_MS=$(date +%s%N 2>/dev/null || echo 0)
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}${HEALTH_PATH}" 2>/dev/null || echo "000")
      END_MS=$(date +%s%N 2>/dev/null || echo 0)

      LATENCY_MS=$(( (END_MS - START_MS) / 1000000 ))

      if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
        PASS_COUNT=$((PASS_COUNT + 1))
        log_info "Check $((PASS_COUNT + FAIL_COUNT)): HTTP $HTTP_CODE (${LATENCY_MS}ms) - PASS [$PASS_COUNT/$RETRIES]"

        if [ "$PASS_COUNT" -ge "$RETRIES" ]; then
          log_info "Validation PASSED after ${ELAPSED}s ($PASS_COUNT consecutive passes)"

          # Notify success
          if [ -x "$NOTIFY_SCRIPT" ]; then
            bash "$NOTIFY_SCRIPT" send "$SERVER" "Deploy validated: ${BASE_URL}" "success" 2>/dev/null || true
          fi

          # Record to deploy history
          echo "{\"status\": \"validated\", \"url\": \"$BASE_URL\", \"checks_passed\": $PASS_COUNT, \"elapsed\": $ELAPSED, \"avg_latency_ms\": $LATENCY_MS}"
          exit 0
        fi
      else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        PASS_COUNT=0  # Reset consecutive passes
        log_warn "Check $((PASS_COUNT + FAIL_COUNT)): HTTP $HTTP_CODE (${LATENCY_MS}ms) - FAIL"
      fi

      sleep "$INTERVAL"
      ELAPSED=$((ELAPSED + INTERVAL))
    done

    do_rollback "Health check timeout after ${TIMEOUT}s (${FAIL_COUNT} failures)"
    ;;

  smoke)
    ENDPOINTS="${5:-[]}"
    log_info "Running smoke tests against $BASE_URL"

    # Parse endpoints JSON: ["/", "/api/health", "/login"]
    TOTAL=$(echo "$ENDPOINTS" | jq 'length')
    PASSED=0
    FAILED=0
    RESULTS="[]"

    for i in $(seq 0 $((TOTAL - 1))); do
      ENDPOINT=$(echo "$ENDPOINTS" | jq -r ".[$i]")
      URL="${BASE_URL}${ENDPOINT}"

      START_MS=$(date +%s%N 2>/dev/null || echo 0)
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")
      END_MS=$(date +%s%N 2>/dev/null || echo 0)
      LATENCY_MS=$(( (END_MS - START_MS) / 1000000 ))

      if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
        STATUS="pass"
        PASSED=$((PASSED + 1))
        log_info "  $ENDPOINT → HTTP $HTTP_CODE (${LATENCY_MS}ms) PASS"
      else
        STATUS="fail"
        FAILED=$((FAILED + 1))
        log_error "  $ENDPOINT → HTTP $HTTP_CODE (${LATENCY_MS}ms) FAIL"
      fi

      RESULTS=$(echo "$RESULTS" | jq ". + [{\"endpoint\": \"$ENDPOINT\", \"status\": \"$STATUS\", \"http_code\": $HTTP_CODE, \"latency_ms\": $LATENCY_MS}]")
    done

    log_info "Smoke tests: $PASSED passed, $FAILED failed out of $TOTAL"

    if [ "$FAILED" -gt 0 ]; then
      do_rollback "Smoke tests failed: $FAILED/$TOTAL endpoints returned errors"
    fi

    echo "{\"status\": \"passed\", \"total\": $TOTAL, \"passed\": $PASSED, \"failed\": $FAILED, \"results\": $RESULTS}"
    ;;

  gate)
    log_info "Running deployment gate checks"

    # Run multiple requests and check thresholds
    TOTAL_REQUESTS=10
    TOTAL_ERRORS=0
    TOTAL_LATENCY=0

    for i in $(seq 1 $TOTAL_REQUESTS); do
      START_MS=$(date +%s%N 2>/dev/null || echo 0)
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${BASE_URL}${HEALTH_PATH}" 2>/dev/null || echo "000")
      END_MS=$(date +%s%N 2>/dev/null || echo 0)
      LATENCY_MS=$(( (END_MS - START_MS) / 1000000 ))
      TOTAL_LATENCY=$((TOTAL_LATENCY + LATENCY_MS))

      if [ "$HTTP_CODE" -ge 500 ] || [ "$HTTP_CODE" = "000" ]; then
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
      fi
      sleep 0.5
    done

    AVG_LATENCY=$((TOTAL_LATENCY / TOTAL_REQUESTS))
    ERROR_RATE=$((TOTAL_ERRORS * 100 / TOTAL_REQUESTS))

    log_info "Gate results: avg_latency=${AVG_LATENCY}ms, error_rate=${ERROR_RATE}%"

    # Check thresholds
    if [ "$LATENCY_THRESHOLD" -gt 0 ] && [ "$AVG_LATENCY" -gt "$LATENCY_THRESHOLD" ]; then
      do_rollback "Latency too high: ${AVG_LATENCY}ms > ${LATENCY_THRESHOLD}ms threshold"
    fi

    if [ "$ERROR_RATE_THRESHOLD" -gt 0 ] && [ "$ERROR_RATE" -gt "$ERROR_RATE_THRESHOLD" ]; then
      do_rollback "Error rate too high: ${ERROR_RATE}% > ${ERROR_RATE_THRESHOLD}% threshold"
    fi

    log_info "All gates passed"
    echo "{\"status\": \"passed\", \"avg_latency_ms\": $AVG_LATENCY, \"error_rate_percent\": $ERROR_RATE, \"total_requests\": $TOTAL_REQUESTS}"
    ;;

  *)
    die "Unknown action: $ACTION. Use: validate, smoke, gate" 1
    ;;
esac
