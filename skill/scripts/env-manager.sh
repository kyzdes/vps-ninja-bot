#!/bin/bash
# Environment variable manager with audit trail
# Usage:
#   env-manager.sh list    <server> <app-id>                    # List env vars (masked)
#   env-manager.sh get     <server> <app-id> <key>              # Get specific var
#   env-manager.sh set     <server> <app-id> <key>=<value>      # Set with audit
#   env-manager.sh delete  <server> <app-id> <key>              # Delete with audit
#   env-manager.sh diff    <server> <app-id-1> <app-id-2>       # Compare envs
#   env-manager.sh export  <server> <app-id>                    # Export as .env format
#   env-manager.sh import  <server> <app-id> <env-file>         # Import from .env file
#   env-manager.sh audit   <server> [app-id]                    # Show change history
#
# Exit codes: 0 = success, 1 = config error, 2 = operation error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq

ACTION="${1:?Usage: env-manager.sh <list|get|set|delete|diff|export|import|audit> ...}"
SERVER="${2:?Missing server name}"

API_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/dokploy-api.sh"
HISTORY_FILE="$SCRIPT_DIR/../config/env-history.json"

# Ensure history file exists
if [ ! -f "$HISTORY_FILE" ]; then
  echo '[]' > "$HISTORY_FILE"
fi

# ── Audit logging ──

audit_log() {
  local app_id="$1" action="$2" key="$3" details="${4:-}"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local user=$(whoami 2>/dev/null || echo "unknown")

  local entry=$(jq -n \
    --arg ts "$timestamp" \
    --arg user "$user" \
    --arg server "$SERVER" \
    --arg app "$app_id" \
    --arg action "$action" \
    --arg key "$key" \
    --arg details "$details" \
    '{timestamp: $ts, user: $user, server: $server, app_id: $app, action: $action, key: $key, details: $details}')

  # Append to history (keep last 500 entries)
  local updated
  updated=$(jq ". + [$entry] | .[-500:]" "$HISTORY_FILE" 2>/dev/null) || updated="[$entry]"
  echo "$updated" > "$HISTORY_FILE"

  log_debug "Audit: $action $key on $app_id"
}

# ── Helpers ──

# Get current env string from Dokploy application
get_app_env() {
  local app_id="$1"
  bash "$API_SCRIPT" "$SERVER" GET "application.one?applicationId=$app_id" 2>/dev/null | jq -r '.env // ""'
}

# Parse env string to JSON object
env_to_json() {
  local env_str="$1"
  echo "$env_str" | grep -v '^#' | grep -v '^$' | while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    printf '"%s": "%s",' "$key" "$value"
  done | sed 's/,$//' | printf '{%s}' "$(cat)"
}

# Mask secret values for display
mask_value() {
  local key="$1" value="$2"
  # Mask if key looks like a secret
  if echo "$key" | grep -qiE '(secret|password|token|key|api_key|private|credential)'; then
    mask_secret "$value"
  else
    echo "$value"
  fi
}

# ── Commands ──

case "$ACTION" in
  list)
    APP_ID="${3:?Missing application ID}"
    log_info "Environment variables for app $APP_ID:"

    ENV_STR=$(get_app_env "$APP_ID")
    if [ -z "$ENV_STR" ]; then
      log_info "No environment variables set"
      echo '{"vars": {}, "count": 0}'
      exit 0
    fi

    COUNT=0
    echo "$ENV_STR" | grep -v '^#' | grep -v '^$' | while IFS='=' read -r key value; do
      [ -z "$key" ] && continue
      MASKED=$(mask_value "$key" "$value")
      printf "  %-30s = %s\n" "$key" "$MASKED"
      COUNT=$((COUNT + 1))
    done

    TOTAL=$(echo "$ENV_STR" | grep -c '=' || echo 0)
    echo "{\"count\": $TOTAL}"
    ;;

  get)
    APP_ID="${3:?Missing application ID}"
    KEY="${4:?Missing variable name}"

    ENV_STR=$(get_app_env "$APP_ID")
    VALUE=$(echo "$ENV_STR" | grep "^${KEY}=" | head -1 | cut -d'=' -f2-)

    if [ -z "$VALUE" ]; then
      die "Variable '$KEY' not found" 2
    fi

    echo "$VALUE"
    ;;

  set)
    APP_ID="${3:?Missing application ID}"
    PAIR="${4:?Missing KEY=VALUE pair}"
    KEY="${PAIR%%=*}"
    VALUE="${PAIR#*=}"

    [ -z "$KEY" ] && die "Invalid KEY=VALUE format: $PAIR" 1

    log_info "Setting $KEY on app $APP_ID"

    # Get current env
    ENV_STR=$(get_app_env "$APP_ID")

    # Remove existing key (if present) and add new
    NEW_ENV=$(echo "$ENV_STR" | grep -v "^${KEY}=")
    NEW_ENV="${NEW_ENV}
${KEY}=${VALUE}"
    NEW_ENV=$(echo "$NEW_ENV" | grep -v '^$')

    # Save via API
    ESCAPED_ENV=$(echo "$NEW_ENV" | jq -Rs .)
    bash "$API_SCRIPT" "$SERVER" POST application.saveEnvironment \
      "{\"applicationId\": \"$APP_ID\", \"env\": $ESCAPED_ENV}" >/dev/null 2>&1 || die "Failed to save env" 2

    audit_log "$APP_ID" "set" "$KEY" "value updated"
    log_info "Variable '$KEY' updated"
    echo "{\"status\": \"ok\", \"key\": \"$KEY\", \"action\": \"set\"}"
    ;;

  delete)
    APP_ID="${3:?Missing application ID}"
    KEY="${4:?Missing variable name}"

    log_info "Deleting $KEY from app $APP_ID"

    ENV_STR=$(get_app_env "$APP_ID")
    NEW_ENV=$(echo "$ENV_STR" | grep -v "^${KEY}=")

    ESCAPED_ENV=$(echo "$NEW_ENV" | jq -Rs .)
    bash "$API_SCRIPT" "$SERVER" POST application.saveEnvironment \
      "{\"applicationId\": \"$APP_ID\", \"env\": $ESCAPED_ENV}" >/dev/null 2>&1 || die "Failed to save env" 2

    audit_log "$APP_ID" "delete" "$KEY" "variable removed"
    log_info "Variable '$KEY' deleted"
    echo "{\"status\": \"ok\", \"key\": \"$KEY\", \"action\": \"deleted\"}"
    ;;

  diff)
    APP_ID_1="${3:?Missing first application ID}"
    APP_ID_2="${4:?Missing second application ID}"

    log_info "Comparing environments: $APP_ID_1 vs $APP_ID_2"

    ENV_1=$(get_app_env "$APP_ID_1")
    ENV_2=$(get_app_env "$APP_ID_2")

    # Extract keys
    KEYS_1=$(echo "$ENV_1" | grep '=' | cut -d'=' -f1 | sort)
    KEYS_2=$(echo "$ENV_2" | grep '=' | cut -d'=' -f1 | sort)

    echo "=== Only in app $APP_ID_1 ==="
    comm -23 <(echo "$KEYS_1") <(echo "$KEYS_2") | while read -r key; do
      echo "  + $key"
    done

    echo ""
    echo "=== Only in app $APP_ID_2 ==="
    comm -13 <(echo "$KEYS_1") <(echo "$KEYS_2") | while read -r key; do
      echo "  + $key"
    done

    echo ""
    echo "=== Different values ==="
    comm -12 <(echo "$KEYS_1") <(echo "$KEYS_2") | while read -r key; do
      VAL_1=$(echo "$ENV_1" | grep "^${key}=" | cut -d'=' -f2-)
      VAL_2=$(echo "$ENV_2" | grep "^${key}=" | cut -d'=' -f2-)
      if [ "$VAL_1" != "$VAL_2" ]; then
        echo "  ~ $key"
        echo "    app1: $(mask_value "$key" "$VAL_1")"
        echo "    app2: $(mask_value "$key" "$VAL_2")"
      fi
    done
    ;;

  export)
    APP_ID="${3:?Missing application ID}"
    log_info "Exporting env for app $APP_ID"
    get_app_env "$APP_ID"
    ;;

  import)
    APP_ID="${3:?Missing application ID}"
    ENV_FILE="${4:?Missing .env file path}"

    [ ! -f "$ENV_FILE" ] && die "File not found: $ENV_FILE" 1

    log_info "Importing env from $ENV_FILE to app $APP_ID"

    NEW_ENV=$(grep -v '^#' "$ENV_FILE" | grep -v '^$')
    ESCAPED_ENV=$(echo "$NEW_ENV" | jq -Rs .)

    bash "$API_SCRIPT" "$SERVER" POST application.saveEnvironment \
      "{\"applicationId\": \"$APP_ID\", \"env\": $ESCAPED_ENV}" >/dev/null 2>&1 || die "Failed to import env" 2

    COUNT=$(echo "$NEW_ENV" | grep -c '=' || echo 0)
    audit_log "$APP_ID" "import" "*" "imported $COUNT variables from $ENV_FILE"
    log_info "Imported $COUNT variables"
    echo "{\"status\": \"ok\", \"imported\": $COUNT}"
    ;;

  audit)
    APP_ID="${3:-}"
    log_info "Environment audit trail"

    if [ -n "$APP_ID" ]; then
      jq "[.[] | select(.app_id == \"$APP_ID\" and .server == \"$SERVER\")] | reverse | .[:50]" "$HISTORY_FILE"
    else
      jq "[.[] | select(.server == \"$SERVER\")] | reverse | .[:50]" "$HISTORY_FILE"
    fi
    ;;

  *)
    die "Unknown action: $ACTION. Use: list, get, set, delete, diff, export, import, audit" 1
    ;;
esac
