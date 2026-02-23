#!/bin/bash
# Database backup & restore via SSH + Docker
# Usage:
#   backup.sh create  <server> <db-type> <container-name> [backup-dir]
#   backup.sh restore <server> <db-type> <container-name> <backup-file>
#   backup.sh list    <server> [backup-dir]
#   backup.sh cleanup <server> [backup-dir] [keep-count]
#
# Supported db-type: postgres, mysql, mariadb, mongo, redis
#
# Examples:
#   backup.sh create main postgres my-app-db
#   backup.sh restore main postgres my-app-db /backups/my-app-db-2026-02-23.sql.gz
#   backup.sh list main
#   backup.sh cleanup main /backups 5
#
# Exit codes: 0 = success, 1 = config error, 2 = backup error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ACTION="${1:?Usage: backup.sh <create|restore|list|cleanup> <server> ...}"
SERVER="${2:?Missing server name}"

BACKUP_DIR="${VPS_BACKUP_DIR:-/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Load the SSH helper path
SSH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ssh-exec.sh"

run_remote() {
  bash "$SSH_SCRIPT" "$SERVER" "$1"
}

case "$ACTION" in
  create)
    DB_TYPE="${3:?Missing database type (postgres/mysql/mariadb/mongo/redis)}"
    CONTAINER="${4:?Missing container/service name}"
    BACKUP_DIR="${5:-$BACKUP_DIR}"
    BACKUP_FILE="${BACKUP_DIR}/${CONTAINER}-${TIMESTAMP}"

    # Ensure backup directory exists
    run_remote "mkdir -p $BACKUP_DIR"

    case "$DB_TYPE" in
      postgres)
        log_info "Backing up PostgreSQL: $CONTAINER → ${BACKUP_FILE}.sql.gz"
        run_remote "docker exec \$(docker ps -q -f name=$CONTAINER) pg_dumpall -U postgres 2>/dev/null | gzip > ${BACKUP_FILE}.sql.gz"
        BACKUP_FILE="${BACKUP_FILE}.sql.gz"
        ;;
      mysql|mariadb)
        log_info "Backing up MySQL/MariaDB: $CONTAINER → ${BACKUP_FILE}.sql.gz"
        run_remote "docker exec \$(docker ps -q -f name=$CONTAINER) mysqldump --all-databases -u root 2>/dev/null | gzip > ${BACKUP_FILE}.sql.gz"
        BACKUP_FILE="${BACKUP_FILE}.sql.gz"
        ;;
      mongo)
        log_info "Backing up MongoDB: $CONTAINER → ${BACKUP_FILE}.archive"
        run_remote "docker exec \$(docker ps -q -f name=$CONTAINER) mongodump --archive 2>/dev/null > ${BACKUP_FILE}.archive"
        BACKUP_FILE="${BACKUP_FILE}.archive"
        ;;
      redis)
        log_info "Backing up Redis: $CONTAINER → ${BACKUP_FILE}.rdb"
        run_remote "docker exec \$(docker ps -q -f name=$CONTAINER) redis-cli BGSAVE 2>/dev/null && sleep 2 && docker cp \$(docker ps -q -f name=$CONTAINER):/data/dump.rdb ${BACKUP_FILE}.rdb"
        BACKUP_FILE="${BACKUP_FILE}.rdb"
        ;;
      *)
        die "Unsupported database type: $DB_TYPE. Use: postgres, mysql, mariadb, mongo, redis" 1
        ;;
    esac

    # Get backup file size
    SIZE=$(run_remote "du -h $BACKUP_FILE 2>/dev/null | cut -f1" || echo "unknown")
    log_info "Backup complete: $BACKUP_FILE ($SIZE)"

    echo "{\"status\": \"ok\", \"file\": \"$BACKUP_FILE\", \"size\": \"$SIZE\", \"db_type\": \"$DB_TYPE\", \"container\": \"$CONTAINER\", \"timestamp\": \"$TIMESTAMP\"}"
    ;;

  restore)
    DB_TYPE="${3:?Missing database type}"
    CONTAINER="${4:?Missing container/service name}"
    BACKUP_FILE="${5:?Missing backup file path}"

    # Verify backup exists
    run_remote "test -f $BACKUP_FILE" || die "Backup file not found: $BACKUP_FILE" 2

    case "$DB_TYPE" in
      postgres)
        log_info "Restoring PostgreSQL from $BACKUP_FILE"
        run_remote "gunzip -c $BACKUP_FILE | docker exec -i \$(docker ps -q -f name=$CONTAINER) psql -U postgres 2>/dev/null"
        ;;
      mysql|mariadb)
        log_info "Restoring MySQL/MariaDB from $BACKUP_FILE"
        run_remote "gunzip -c $BACKUP_FILE | docker exec -i \$(docker ps -q -f name=$CONTAINER) mysql -u root 2>/dev/null"
        ;;
      mongo)
        log_info "Restoring MongoDB from $BACKUP_FILE"
        run_remote "docker exec -i \$(docker ps -q -f name=$CONTAINER) mongorestore --archive < $BACKUP_FILE 2>/dev/null"
        ;;
      redis)
        log_info "Restoring Redis from $BACKUP_FILE"
        run_remote "docker cp $BACKUP_FILE \$(docker ps -q -f name=$CONTAINER):/data/dump.rdb && docker exec \$(docker ps -q -f name=$CONTAINER) redis-cli DEBUG LOADRDB /data/dump.rdb 2>/dev/null"
        ;;
      *)
        die "Unsupported database type: $DB_TYPE" 1
        ;;
    esac

    log_info "Restore complete from $BACKUP_FILE"
    echo "{\"status\": \"ok\", \"restored_from\": \"$BACKUP_FILE\", \"db_type\": \"$DB_TYPE\", \"container\": \"$CONTAINER\"}"
    ;;

  list)
    BACKUP_DIR="${3:-$BACKUP_DIR}"
    log_info "Listing backups in $BACKUP_DIR on server $SERVER"

    run_remote "ls -lhS $BACKUP_DIR/ 2>/dev/null | tail -n +2 || echo 'No backups found'"
    ;;

  cleanup)
    BACKUP_DIR="${3:-$BACKUP_DIR}"
    KEEP="${4:-5}"

    log_info "Cleaning up old backups in $BACKUP_DIR (keeping last $KEEP)"

    # Count and remove old backups
    DELETED=$(run_remote "
      cd $BACKUP_DIR 2>/dev/null || exit 0
      TOTAL=\$(ls -1t 2>/dev/null | wc -l)
      if [ \"\$TOTAL\" -gt $KEEP ]; then
        ls -1t | tail -n +\$(($KEEP + 1)) | xargs rm -f
        echo \$((\$TOTAL - $KEEP))
      else
        echo 0
      fi
    ")

    log_info "Deleted $DELETED old backup(s)"
    echo "{\"status\": \"ok\", \"deleted\": $DELETED, \"kept\": $KEEP}"
    ;;

  *)
    die "Unknown action: $ACTION. Use: create, restore, list, cleanup" 1
    ;;
esac
