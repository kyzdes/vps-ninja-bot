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

SSH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ssh-exec.sh"

run_remote() {
  bash "$SSH_SCRIPT" "$SERVER" "$1"
}

CRON_DIR="/opt/vps-ninja/cron"

case "$ACTION" in
  list)
    log_info "Cron jobs on $SERVER"
    run_remote "
      mkdir -p $CRON_DIR
      if [ -f $CRON_DIR/jobs.json ]; then
        cat $CRON_DIR/jobs.json | jq '.'
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

    log_info "Adding cron job '$NAME': $SCHEDULE"

    # Build the actual command
    if [ -n "$CONTAINER" ]; then
      FULL_CMD="docker exec \$(docker ps -q -f name=$CONTAINER) $COMMAND"
    else
      FULL_CMD="$COMMAND"
    fi

    run_remote "
      mkdir -p $CRON_DIR/logs

      # Save job metadata
      if [ ! -f $CRON_DIR/jobs.json ]; then
        echo '[]' > $CRON_DIR/jobs.json
      fi

      # Remove existing job with same name
      jq '[.[] | select(.name != \"$NAME\")]' $CRON_DIR/jobs.json > $CRON_DIR/jobs.tmp
      mv $CRON_DIR/jobs.tmp $CRON_DIR/jobs.json

      # Add new job
      jq '. + [{
        \"name\": \"$NAME\",
        \"schedule\": \"$SCHEDULE\",
        \"command\": \"$COMMAND\",
        \"container\": \"${CONTAINER:-null}\",
        \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"enabled\": true
      }]' $CRON_DIR/jobs.json > $CRON_DIR/jobs.tmp
      mv $CRON_DIR/jobs.tmp $CRON_DIR/jobs.json

      # Create wrapper script
      cat > $CRON_DIR/$NAME.sh << 'WRAPPER'
#!/bin/bash
LOG_FILE=\"$CRON_DIR/logs/$NAME-\$(date +%Y%m%d).log\"
echo \"[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] START $NAME\" >> \"\$LOG_FILE\"
$FULL_CMD >> \"\$LOG_FILE\" 2>&1
EXIT_CODE=\$?
echo \"[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] END $NAME (exit: \$EXIT_CODE)\" >> \"\$LOG_FILE\"
# Keep only last 7 days of logs
find $CRON_DIR/logs -name '$NAME-*' -mtime +7 -delete 2>/dev/null
WRAPPER
      chmod +x $CRON_DIR/$NAME.sh

      # Add to system crontab
      (crontab -l 2>/dev/null | grep -v \"# vps-ninja:$NAME\"; echo \"$SCHEDULE $CRON_DIR/$NAME.sh # vps-ninja:$NAME\") | crontab -
    "

    log_info "Cron job '$NAME' added: $SCHEDULE"
    echo "{\"status\": \"added\", \"name\": \"$NAME\", \"schedule\": \"$SCHEDULE\"}"
    ;;

  remove)
    NAME="${3:?Missing job name}"

    log_info "Removing cron job '$NAME'"

    run_remote "
      # Remove from crontab
      crontab -l 2>/dev/null | grep -v \"# vps-ninja:$NAME\" | crontab -

      # Remove from jobs.json
      if [ -f $CRON_DIR/jobs.json ]; then
        jq '[.[] | select(.name != \"$NAME\")]' $CRON_DIR/jobs.json > $CRON_DIR/jobs.tmp
        mv $CRON_DIR/jobs.tmp $CRON_DIR/jobs.json
      fi

      # Remove script
      rm -f $CRON_DIR/$NAME.sh
    "

    log_info "Cron job '$NAME' removed"
    echo "{\"status\": \"removed\", \"name\": \"$NAME\"}"
    ;;

  logs)
    NAME="${3:?Missing job name}"
    TAIL_N="${4:-50}"

    log_info "Logs for cron job '$NAME' (last $TAIL_N lines)"
    run_remote "
      LOG_FILE=\$(ls -t $CRON_DIR/logs/${NAME}-* 2>/dev/null | head -1)
      if [ -n \"\$LOG_FILE\" ]; then
        tail -n $TAIL_N \"\$LOG_FILE\"
      else
        echo 'No logs found for job: $NAME'
      fi
    "
    ;;

  run)
    NAME="${3:?Missing job name}"

    log_info "Running cron job '$NAME' immediately"
    run_remote "
      if [ -x $CRON_DIR/$NAME.sh ]; then
        bash $CRON_DIR/$NAME.sh
        echo '{\"status\": \"executed\", \"name\": \"$NAME\"}'
      else
        echo '{\"error\": \"Job script not found: $NAME\"}'
        exit 2
      fi
    "
    ;;

  status)
    log_info "Cron jobs status on $SERVER"
    run_remote "
      echo '=== System Crontab (vps-ninja) ==='
      crontab -l 2>/dev/null | grep 'vps-ninja:' || echo 'No jobs'

      echo ''
      echo '=== Recent Executions ==='
      for log in $CRON_DIR/logs/*-\$(date +%Y%m%d).log 2>/dev/null; do
        [ -f \"\$log\" ] && echo \"--- \$(basename \$log) ---\" && tail -3 \"\$log\"
      done
    "
    ;;

  *)
    die "Unknown action: $ACTION. Use: list, add, remove, logs, run, status" 1
    ;;
esac
