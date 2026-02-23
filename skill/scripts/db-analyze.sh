#!/bin/bash
# Database analysis — slow queries, index analysis, size trending
# Usage:
#   db-analyze.sh stats    <server> <db-type> <container>    # DB size and connections
#   db-analyze.sh slowlog  <server> <db-type> <container> [top-n]  # Slow queries
#   db-analyze.sh indexes  <server> <container> <db-name>    # Index analysis (postgres)
#   db-analyze.sh tables   <server> <container> <db-name>    # Table sizes
#   db-analyze.sh connections <server> <db-type> <container> # Active connections
#
# Supported db-type: postgres, mysql
# Exit codes: 0 = success, 1 = config error, 2 = query error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq

ACTION="${1:?Usage: db-analyze.sh <stats|slowlog|indexes|tables|connections> <server> ...}"
SERVER="${2:?Missing server name}"

run_remote() {
  bash "${SCRIPT_DIR}/ssh-exec.sh" "$SERVER" "$1"
}

# Safe Docker exec helpers — escape container name and query to prevent injection
docker_exec_pg() {
  local container="$1" query="$2"
  local safe_container
  safe_container=$(shell_escape "$container")
  # Pass query via stdin to avoid shell metacharacter issues
  run_remote "docker exec -i \$(docker ps -q -f name=${safe_container}) psql -U postgres -t -A 2>/dev/null << 'PGQUERY'
${query}
PGQUERY"
}

docker_exec_mysql() {
  local container="$1" query="$2"
  local safe_container
  safe_container=$(shell_escape "$container")
  run_remote "docker exec -i \$(docker ps -q -f name=${safe_container}) mysql -u root 2>/dev/null << 'MYQUERY'
${query}
MYQUERY"
}

case "$ACTION" in
  stats)
    DB_TYPE="${3:?Missing database type}"
    CONTAINER="${4:?Missing container name}"

    validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1

    log_info "Database statistics for $CONTAINER ($DB_TYPE)"

    case "$DB_TYPE" in
      postgres)
        docker_exec_pg "$CONTAINER" "
          SELECT json_build_object(
            'version', version(),
            'uptime', now() - pg_postmaster_start_time(),
            'total_size', pg_size_pretty(sum(pg_database_size(datname))),
            'total_size_bytes', sum(pg_database_size(datname)),
            'databases', count(*),
            'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
            'total_connections', (SELECT count(*) FROM pg_stat_activity),
            'max_connections', current_setting('max_connections')
          ) FROM pg_database WHERE NOT datistemplate;
        "
        ;;
      mysql)
        docker_exec_mysql "$CONTAINER" "
          SELECT JSON_OBJECT(
            'version', VERSION(),
            'uptime_seconds', VARIABLE_VALUE
          ) FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime';
        "
        local safe_container
        safe_container=$(shell_escape "$CONTAINER")
        run_remote "docker exec -i \$(docker ps -q -f name=${safe_container}) mysql -u root 2>/dev/null << 'MYQUERY'
SELECT table_schema AS db,
       ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables GROUP BY table_schema;
MYQUERY"
        ;;
      *)
        die "Unsupported DB type for stats: $DB_TYPE. Use: postgres, mysql" 1
        ;;
    esac
    ;;

  slowlog)
    DB_TYPE="${3:?Missing database type}"
    CONTAINER="${4:?Missing container name}"
    TOP_N="${5:-10}"

    validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1
    validate_int "$TOP_N" || die "Top-N must be a positive integer, got: $TOP_N" 1

    log_info "Top $TOP_N slowest queries in $CONTAINER"

    case "$DB_TYPE" in
      postgres)
        # Check if pg_stat_statements extension is available
        HAS_STATS=$(docker_exec_pg "$CONTAINER" "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_stat_statements';" 2>/dev/null)
        if [ "$HAS_STATS" = "0" ] || [ -z "$HAS_STATS" ]; then
          log_warn "pg_stat_statements not enabled. Enabling..."
          docker_exec_pg "$CONTAINER" "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" 2>/dev/null
          log_info "Extension created. Run queries, then check again for slow query data."
          echo '{"status": "extension_enabled", "note": "Run queries then re-check for slow query data"}'
          exit 0
        fi

        docker_exec_pg "$CONTAINER" "
          SELECT json_agg(row_to_json(t)) FROM (
            SELECT
              query,
              calls,
              ROUND(total_exec_time::numeric, 2) AS total_time_ms,
              ROUND(mean_exec_time::numeric, 2) AS avg_time_ms,
              ROUND(max_exec_time::numeric, 2) AS max_time_ms,
              rows
            FROM pg_stat_statements
            ORDER BY mean_exec_time DESC
            LIMIT ${TOP_N}
          ) t;
        "
        ;;
      mysql)
        docker_exec_mysql "$CONTAINER" "
          SELECT * FROM performance_schema.events_statements_summary_by_digest
          ORDER BY AVG_TIMER_WAIT DESC LIMIT ${TOP_N}\G
        "
        ;;
      *)
        die "Unsupported DB type for slowlog: $DB_TYPE" 1
        ;;
    esac
    ;;

  indexes)
    CONTAINER="${3:?Missing container name}"
    DB_NAME="${4:?Missing database name}"

    validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1

    log_info "Index analysis for $DB_NAME in $CONTAINER"

    # Missing indexes (tables with seq scans but no index)
    echo "=== Missing Indexes (high seq scan tables) ==="
    docker_exec_pg "$CONTAINER" "
      SELECT schemaname, relname AS table,
             seq_scan, idx_scan,
             CASE WHEN seq_scan + idx_scan > 0
                  THEN ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 1)
                  ELSE 0 END AS idx_scan_pct,
             pg_size_pretty(pg_relation_size(relid)) AS size
      FROM pg_stat_user_tables
      WHERE seq_scan > 100 AND (idx_scan IS NULL OR idx_scan < seq_scan)
      ORDER BY seq_scan DESC
      LIMIT 20;
    "

    echo ""
    echo "=== Unused Indexes ==="
    docker_exec_pg "$CONTAINER" "
      SELECT schemaname, indexrelname AS index, relname AS table,
             idx_scan AS scans,
             pg_size_pretty(pg_relation_size(indexrelid)) AS size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 20;
    "

    echo ""
    echo "=== Duplicate Indexes ==="
    docker_exec_pg "$CONTAINER" "
      SELECT pg_size_pretty(sum(pg_relation_size(idx))::bigint) AS size,
             (array_agg(idx))[1] AS idx1, (array_agg(idx))[2] AS idx2,
             (array_agg(idx))[1]::regclass AS index1, (array_agg(idx))[2]::regclass AS index2
      FROM (
        SELECT indexrelid::regclass AS idx, indrelid, indkey,
               coalesce(indexprs::text,''), coalesce(indpred::text,'')
        FROM pg_index
      ) sub
      GROUP BY indrelid, indkey, coalesce, coalesce
      HAVING count(*) > 1
      LIMIT 10;
    "
    ;;

  tables)
    CONTAINER="${3:?Missing container name}"
    DB_NAME="${4:?Missing database name}"

    validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1

    log_info "Table sizes in $DB_NAME"

    docker_exec_pg "$CONTAINER" "
      SELECT schemaname, relname AS table,
             n_live_tup AS rows,
             pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
             pg_size_pretty(pg_relation_size(relid)) AS data_size,
             pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 30;
    "
    ;;

  connections)
    DB_TYPE="${3:?Missing database type}"
    CONTAINER="${4:?Missing container name}"

    validate_name "$CONTAINER" || die "Invalid container name: $CONTAINER" 1

    log_info "Active connections in $CONTAINER"

    case "$DB_TYPE" in
      postgres)
        docker_exec_pg "$CONTAINER" "
          SELECT json_agg(row_to_json(t)) FROM (
            SELECT datname AS database, usename AS user, client_addr, state,
                   query, now() - query_start AS duration
            FROM pg_stat_activity
            WHERE state IS NOT NULL
            ORDER BY query_start
          ) t;
        "
        ;;
      mysql)
        docker_exec_mysql "$CONTAINER" "SHOW PROCESSLIST;"
        ;;
      *)
        die "Unsupported DB type: $DB_TYPE" 1
        ;;
    esac
    ;;

  *)
    die "Unknown action: $ACTION. Use: stats, slowlog, indexes, tables, connections" 1
    ;;
esac

exit 0
