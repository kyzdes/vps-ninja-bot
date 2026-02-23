#!/bin/bash
# Advanced health check and monitoring
# Usage:
#   health-check.sh server  <server-name>               # Full server health report
#   health-check.sh app     <server-name> <app-name>     # Application health
#   health-check.sh docker  <server-name>                # Docker services status
#   health-check.sh disk    <server-name>                # Disk usage warnings
#   health-check.sh ssl     <domain>                     # SSL certificate check
#
# Exit codes: 0 = healthy, 1 = config error, 2 = unhealthy/warnings

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq curl

ACTION="${1:?Usage: health-check.sh <server|app|docker|disk|ssl> ...}"

SSH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ssh-exec.sh"
API_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/dokploy-api.sh"

run_remote() {
  bash "$SSH_SCRIPT" "$1" "$2"
}

case "$ACTION" in
  server)
    SERVER="${2:?Missing server name}"
    log_info "Running server health check: $SERVER"

    HEALTH=$(run_remote "$SERVER" '
      echo "{"
      echo "  \"hostname\": \"$(hostname)\","
      echo "  \"uptime\": \"$(uptime -p 2>/dev/null || uptime)\","
      echo "  \"load\": \"$(cat /proc/loadavg | cut -d\" \" -f1-3)\","

      # CPU
      CPU_USAGE=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk "{print \$2}" | cut -d"%" -f1 || echo "0")
      echo "  \"cpu_percent\": $CPU_USAGE,"

      # RAM
      RAM_TOTAL=$(free -m | grep Mem | awk "{print \$2}")
      RAM_USED=$(free -m | grep Mem | awk "{print \$3}")
      RAM_PCT=$((RAM_USED * 100 / RAM_TOTAL))
      echo "  \"ram_total_mb\": $RAM_TOTAL,"
      echo "  \"ram_used_mb\": $RAM_USED,"
      echo "  \"ram_percent\": $RAM_PCT,"

      # Disk
      DISK_PCT=$(df / | tail -1 | awk "{print \$5}" | tr -d "%")
      DISK_AVAIL=$(df -h / | tail -1 | awk "{print \$4}")
      echo "  \"disk_percent\": $DISK_PCT,"
      echo "  \"disk_available\": \"$DISK_AVAIL\","

      # Swap
      SWAP_TOTAL=$(free -m | grep Swap | awk "{print \$2}")
      SWAP_USED=$(free -m | grep Swap | awk "{print \$3}")
      echo "  \"swap_total_mb\": $SWAP_TOTAL,"
      echo "  \"swap_used_mb\": $SWAP_USED,"

      # Docker
      DOCKER_RUNNING=$(docker ps -q 2>/dev/null | wc -l)
      DOCKER_TOTAL=$(docker ps -aq 2>/dev/null | wc -l)
      echo "  \"docker_running\": $DOCKER_RUNNING,"
      echo "  \"docker_total\": $DOCKER_TOTAL,"

      # Docker disk
      DOCKER_DISK=$(docker system df --format "{{.Size}}" 2>/dev/null | head -1 || echo "unknown")
      echo "  \"docker_disk\": \"$DOCKER_DISK\","

      # Open connections
      CONNECTIONS=$(ss -s 2>/dev/null | grep "estab" | head -1 | awk "{print \$4}" | tr -d "," || echo "0")
      echo "  \"connections\": $CONNECTIONS"
      echo "}"
    ')

    echo "$HEALTH"

    # Parse and check thresholds
    if echo "$HEALTH" | jq -e '.ram_percent > 90' 2>/dev/null | grep -q true; then
      log_warn "HIGH RAM usage: $(echo "$HEALTH" | jq -r '.ram_percent')%"
    fi
    if echo "$HEALTH" | jq -e '.disk_percent > 85' 2>/dev/null | grep -q true; then
      log_warn "HIGH DISK usage: $(echo "$HEALTH" | jq -r '.disk_percent')%"
    fi
    if echo "$HEALTH" | jq -e '.cpu_percent > 90' 2>/dev/null | grep -q true; then
      log_warn "HIGH CPU usage: $(echo "$HEALTH" | jq -r '.cpu_percent')%"
    fi
    ;;

  app)
    SERVER="${2:?Missing server name}"
    APP_NAME="${3:?Missing application name}"
    log_info "Checking application health: $APP_NAME on $SERVER"

    # Get app status from Dokploy
    PROJECTS=$(bash "$API_SCRIPT" "$SERVER" GET "project.all" 2>/dev/null) || die "Failed to get projects" 2

    APP_STATUS=$(run_remote "$SERVER" "
      # Find container/service
      SERVICE=\$(docker service ls --format '{{.Name}}' 2>/dev/null | grep -i '$APP_NAME' | head -1)
      if [ -z \"\$SERVICE\" ]; then
        CONTAINER=\$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i '$APP_NAME' | head -1)
        if [ -z \"\$CONTAINER\" ]; then
          echo '{\"status\": \"not_found\", \"app\": \"$APP_NAME\"}'
          exit 0
        fi
        # Container mode
        HEALTH=\$(docker inspect --format '{{.State.Status}}' \"\$CONTAINER\" 2>/dev/null)
        STARTED=\$(docker inspect --format '{{.State.StartedAt}}' \"\$CONTAINER\" 2>/dev/null)
        RESTARTS=\$(docker inspect --format '{{.RestartCount}}' \"\$CONTAINER\" 2>/dev/null)
        echo \"{\\\"status\\\": \\\"\$HEALTH\\\", \\\"app\\\": \\\"$APP_NAME\\\", \\\"started_at\\\": \\\"\$STARTED\\\", \\\"restarts\\\": \$RESTARTS, \\\"mode\\\": \\\"container\\\"}\"
      else
        # Service mode (Swarm)
        REPLICAS=\$(docker service ls --format '{{.Replicas}}' --filter \"name=\$SERVICE\" 2>/dev/null)
        echo \"{\\\"status\\\": \\\"running\\\", \\\"app\\\": \\\"$APP_NAME\\\", \\\"replicas\\\": \\\"\$REPLICAS\\\", \\\"mode\\\": \\\"service\\\"}\"
      fi
    ")

    echo "$APP_STATUS"
    ;;

  docker)
    SERVER="${2:?Missing server name}"
    log_info "Docker services status on $SERVER"

    run_remote "$SERVER" '
      echo "=== Docker Services ==="
      docker service ls --format "table {{.Name}}\t{{.Mode}}\t{{.Replicas}}\t{{.Image}}" 2>/dev/null || echo "Not in Swarm mode"
      echo ""
      echo "=== Running Containers ==="
      docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
      echo ""
      echo "=== Resource Usage ==="
      docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" 2>/dev/null | head -20
    '
    ;;

  disk)
    SERVER="${2:?Missing server name}"
    log_info "Disk usage analysis on $SERVER"

    run_remote "$SERVER" '
      echo "=== Filesystem ==="
      df -h | grep -E "^/"

      echo ""
      echo "=== Largest directories ==="
      du -sh /var/lib/docker/* 2>/dev/null | sort -rh | head -10

      echo ""
      echo "=== Docker disk usage ==="
      docker system df 2>/dev/null

      echo ""
      echo "=== Unused Docker resources ==="
      DANGLING=$(docker images -f "dangling=true" -q 2>/dev/null | wc -l)
      STOPPED=$(docker ps -aq --filter "status=exited" 2>/dev/null | wc -l)
      echo "Dangling images: $DANGLING"
      echo "Stopped containers: $STOPPED"
      if [ "$DANGLING" -gt 0 ] || [ "$STOPPED" -gt 0 ]; then
        echo "Run: docker system prune -f  (to reclaim space)"
      fi
    '
    ;;

  ssl)
    DOMAIN="${2:?Missing domain}"
    log_info "Checking SSL certificate for $DOMAIN"

    require_cmd openssl
    validate_domain "$DOMAIN" || die "Invalid domain: $DOMAIN" 1

    SSL_INFO=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>/dev/null) || {
      log_error "Cannot connect to $DOMAIN:443 for SSL check"
      echo "{\"status\": \"error\", \"domain\": \"$DOMAIN\", \"error\": \"Cannot connect on port 443\"}"
      exit 2
    }

    NOT_AFTER=$(echo "$SSL_INFO" | grep "notAfter" | cut -d= -f2)
    NOT_BEFORE=$(echo "$SSL_INFO" | grep "notBefore" | cut -d= -f2)
    SUBJECT=$(echo "$SSL_INFO" | grep "subject" | sed 's/subject=//')
    ISSUER=$(echo "$SSL_INFO" | grep "issuer" | sed 's/issuer=//')

    # Calculate days until expiry
    EXPIRY_EPOCH=$(date -d "$NOT_AFTER" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$NOT_AFTER" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    json_obj domain "$DOMAIN" subject "$SUBJECT" issuer "$ISSUER" valid_from "$NOT_BEFORE" valid_until "$NOT_AFTER" days_remaining "$DAYS_LEFT"

    if [ "$DAYS_LEFT" -lt 7 ]; then
      log_error "SSL certificate expires in $DAYS_LEFT days!"
      exit 2
    elif [ "$DAYS_LEFT" -lt 30 ]; then
      log_warn "SSL certificate expires in $DAYS_LEFT days"
    else
      log_info "SSL certificate valid for $DAYS_LEFT days"
    fi
    ;;

  *)
    die "Unknown action: $ACTION. Use: server, app, docker, disk, ssl" 1
    ;;
esac
