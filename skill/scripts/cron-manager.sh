#!/bin/bash
# Cron job / scheduled tasks management via Docker
# Usage:
#   cron-manager.sh list    <server>                              # List all cron jobs
#   cron-manager.sh add     <server> <name> <schedule> <command> [container]
#   cron-manager.sh remove  <server> <name>                       # Remove cron job
#   cron-manager.sh logs    <server> <name> [--tail N]            # View job logs
#   cron-manager.sh run     <server> <name>                       # Run job immediately
#   cron-manager.sh status  <server>                              # Status of all jobs
#
# Schedule format: standard cron (e.g., "0 3 * * *" = 3:00 AM daily)
#
# Exit codes: 0 = success, 1 = config error, 2 = operation error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq

ACTION="${1:?Usage: cron-manager.sh <list|add|remove|logs|run|status> <server> ...}"
SERVER="${2:?Missing server name}"

run_remote() {
  bash "${SCRIPT_DIR}/ssh-exec.sh" "$SERVER" "$1"
}

CRON_DIR="/opt/vps-ninja/cron"

# Validate cron schedule format (5 fields)
validate_cron_schedule() {
  local schedule="$1"
  # Basic check: 5 space-separated fields containing only valid cron chars
  [[ "$schedule" =~ ^[0-9*/,-]+[[:space:]]+[0-9*/,-]+[[:space:]]+[0-9*/,-]+[[:space:]]+[0-9*/,-]+[[:space:]]+[0-9*/,-]+$ ]]
}

case "$ACTION" in
  list)
    log_info "Cron jobs on $SERVER"
    run_remote "
      mkdir -p ${CRON_DIR}
      if [ -f ${CRON_DIR}/jobs.json ]; then
        cat ${CRON_DIR}/jobs.json | jq '.'
      else
        echo '[]'
      fi
    "
    ;;

  add)
    NAME="${3:?Missing job name}"
    SCHEDULE="${4:?Missing cron schedule (e.g., '0 3 * * *')}"
    COMMAND="${5:?Missing command to run}"
    CONTAINER="${6:-}"

    # Validate name (prevent path traversal / injection)
    validate_name "$NAME" || die "Invalid job name: '$NAME'. Use alphanumeric, hyphens, underscores only." 1

    # Validate schedule
    validate_cron_schedule "$SCHEDULE" || die "Invalid cron schedule: '$SCHEDULE'. Use format: '0 3 * * *'" 1

    log_info "Adding cron job '$NAME': $SCHEDULE"

    # Shell-escape values for safe interpolation into remote commands
    safe_name=$(shell_escape "$NAME")
    safe_schedule=$(shell_escape "$SCHEDULE")
    safe_command=$(shell_escape "$COMMAND")
    safe_container=$(shell_escape "${CONTAINER:-}")
    created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Build the actual command
    if [ -n "$CONTAINER" ]; then
      validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1
      FULL_CMD="docker exec \$(docker ps -q -f name=${safe_container}) ${safe_command}"
    else
      FULL_CMD="${safe_command}"
    fi

    run_remote "
      mkdir -p ${CRON_DIR}/logs

      # Initialize jobs.json if missing
      if [ ! -f ${CRON_DIR}/jobs.json ]; then
        echo '[]' > ${CRON_DIR}/jobs.json
      fi

      # Remove existing job with same name, then add new one (using jq safely)
      jq --arg name ${safe_name} '[.[] | select(.name != \$name)]' ${CRON_DIR}/jobs.json > ${CRON_DIR}/jobs.tmp
      mv ${CRON_DIR}/jobs.tmp ${CRON_DIR}/jobs.json

      jq --arg name ${safe_name} --arg schedule ${safe_schedule} --arg command ${safe_command} --arg container ${safe_container} --arg created '${created_at}' \\
        '. + [{name: \$name, schedule: \$schedule, command: \$command, container: \$container, created_at: \$created, enabled: true}]' \\
        ${CRON_DIR}/jobs.json > ${CRON_DIR}/jobs.tmp
      mv ${CRON_DIR}/jobs.tmp ${CRON_DIR}/jobs.json

      # Create wrapper script with logging
      cat > ${CRON_DIR}/${safe_name}.sh << WRAPPER
#!/bin/bash
LOG_FILE=\"${CRON_DIR}/logs/${safe_name}-\\\$(date +%Y%m%d).log\"
echo \"[\\\$(date -u +%Y-%m-%dT%H:%M:%SZ)] START ${safe_name}\" >> \"\\\$LOG_FILE\"
${FULL_CMD} >> \"\\\$LOG_FILE\" 2>&1
EXIT_CODE=\\\$?
echo \"[\\\$(date -u +%Y-%m-%dT%H:%M:%SZ)] END ${safe_name} (exit: \\\$EXIT_CODE)\" >> \"\\\$LOG_FILE\"
find ${CRON_DIR}/logs -name '${safe_name}-*' -mtime +7 -delete 2>/dev/null
WRAPPER
      chmod +x ${CRON_DIR}/${safe_name}.sh

      # Add to system crontab (remove old entry first)
      (crontab -l 2>/dev/null | grep -v '# vps-ninja:${safe_name}'; echo '${SCHEDULE} ${CRON_DIR}/${safe_name}.sh # vps-ninja:${safe_name}') | crontab -
    "

    log_info "Cron job '$NAME' added: $SCHEDULE"
    json_obj status added name "$NAME" schedule "$SCHEDULE"
    ;;

  remove)
    NAME="${3:?Missing job name}"
    validate_name "$NAME" || die "Invalid job name: '$NAME'" 1
    safe_name=$(shell_escape "$NAME")

    log_info "Removing cron job '$NAME'"

    run_remote "
      # Remove from crontab
      crontab -l 2>/dev/null | grep -v '# vps-ninja:${safe_name}' | crontab -

      # Remove from jobs.json
      if [ -f ${CRON_DIR}/jobs.json ]; then
        jq --arg name ${safe_name} '[.[] | select(.name != \$name)]' ${CRON_DIR}/jobs.json > ${CRON_DIR}/jobs.tmp
        mv ${CRON_DIR}/jobs.tmp ${CRON_DIR}/jobs.json
      fi

      # Remove script
      rm -f ${CRON_DIR}/${safe_name}.sh
    "

    log_info "Cron job '$NAME' removed"
    json_obj status removed name "$NAME"
    ;;

  logs)
    NAME="${3:?Missing job name}"
    TAIL_N="${4:-50}"

    validate_name "$NAME" || die "Invalid job name: '$NAME'" 1
    validate_int "$TAIL_N" || die "Tail count must be a positive integer, got: $TAIL_N" 1
    safe_name=$(shell_escape "$NAME")

    log_info "Logs for cron job '$NAME' (last $TAIL_N lines)"
    run_remote "
      LOG_FILE=\$(ls -t ${CRON_DIR}/logs/${safe_name}-* 2>/dev/null | head -1)
      if [ -n \"\$LOG_FILE\" ]; then
        tail -n ${TAIL_N} \"\$LOG_FILE\"
      else
        echo 'No logs found for job: ${safe_name}'
      fi
    "
    ;;

  run)
    NAME="${3:?Missing job name}"
    validate_name "$NAME" || die "Invalid job name: '$NAME'" 1
    safe_name=$(shell_escape "$NAME")

    log_info "Running cron job '$NAME' immediately"
    run_remote "
      if [ -x ${CRON_DIR}/${safe_name}.sh ]; then
        bash ${CRON_DIR}/${safe_name}.sh
      else
        echo 'Job script not found: ${safe_name}' >&2
        exit 2
      fi
    "
    json_obj status executed name "$NAME"
    ;;

  status)
    log_info "Cron jobs status on $SERVER"
    run_remote "
      echo '=== System Crontab (vps-ninja) ==='
      crontab -l 2>/dev/null | grep 'vps-ninja:' || echo 'No jobs'

      echo ''
      echo '=== Recent Executions ==='
      for log in ${CRON_DIR}/logs/*-\$(date +%Y%m%d).log 2>/dev/null; do
        [ -f \"\$log\" ] && echo \"--- \$(basename \"\$log\") ---\" && tail -3 \"\$log\"
      done
    "
    ;;

  *)
    die "Unknown action: $ACTION. Use: list, add, remove, logs, run, status" 1
    ;;
esac

exit 0
