#!/bin/bash
# Monitoring stack setup — Prometheus + Grafana + Alertmanager
# Usage:
#   monitor.sh enable   <server>                    # Deploy monitoring stack
#   monitor.sh disable  <server>                    # Remove monitoring stack
#   monitor.sh status   <server>                    # Check monitoring status
#   monitor.sh alert    <server> <channel> <url>    # Configure alert channel
#   monitor.sh query    <server> <promql>            # Query Prometheus
#   monitor.sh dashboard <server>                    # Get Grafana URL
#
# Exit codes: 0 = success, 1 = config error, 2 = operation error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq

ACTION="${1:?Usage: monitor.sh <enable|disable|status|alert|query|dashboard> <server> ...}"
SERVER="${2:?Missing server name}"

SSH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ssh-exec.sh"
API_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/dokploy-api.sh"
TEMPLATES_DIR="$(dirname "${BASH_SOURCE[0]}")/../templates"

run_remote() {
  bash "$SSH_SCRIPT" "$SERVER" "$1"
}

case "$ACTION" in
  enable)
    log_info "Deploying monitoring stack on $SERVER"

    require_server "$SERVER"

    # Step 1: Create monitoring directory
    log_info "Step 1/5: Creating monitoring config..."
    run_remote "mkdir -p /opt/monitoring/{prometheus,grafana,alertmanager}"

    # Step 2: Upload Prometheus config
    log_info "Step 2/5: Configuring Prometheus..."
    run_remote "cat > /opt/monitoring/prometheus/prometheus.yml << 'PROMCFG'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/alert.rules.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'docker'
    static_configs:
      - targets: ['cadvisor:8080']

  - job_name: 'traefik'
    static_configs:
      - targets: ['traefik:8082']
PROMCFG"

    # Step 3: Upload alert rules
    log_info "Step 3/5: Configuring alert rules..."
    run_remote "cat > /opt/monitoring/prometheus/alert.rules.yml << 'ALERTRULES'
groups:
  - name: server_alerts
    rules:
      - alert: HighCPU
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100) > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: \"High CPU usage (> 90%)\"

      - alert: HighMemory
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: \"High memory usage (> 90%)\"

      - alert: DiskAlmostFull
        expr: (1 - node_filesystem_avail_bytes{mountpoint=\"/\"} / node_filesystem_size_bytes{mountpoint=\"/\"}) * 100 > 85
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: \"Disk usage > 85%\"

      - alert: ContainerDown
        expr: absent(container_last_seen{name=~\".+\"})
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: \"Container is down\"

      - alert: SSLExpiringSoon
        expr: probe_ssl_earliest_cert_expiry - time() < 7 * 24 * 3600
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: \"SSL certificate expires in < 7 days\"
ALERTRULES"

    # Step 4: Upload Alertmanager config
    run_remote "cat > /opt/monitoring/alertmanager/alertmanager.yml << 'AMCFG'
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'default'

receivers:
  - name: 'default'
    webhook_configs: []
AMCFG"

    # Step 5: Deploy stack via Docker Compose
    log_info "Step 4/5: Deploying containers..."
    run_remote "cat > /opt/monitoring/docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: vps-ninja-prometheus
    restart: unless-stopped
    ports:
      - '9090:9090'
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./prometheus/alert.rules.yml:/etc/prometheus/alert.rules.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    container_name: vps-ninja-grafana
    restart: unless-stopped
    ports:
      - '3001:3000'
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=vpsninja2026
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
    networks:
      - monitoring

  alertmanager:
    image: prom/alertmanager:latest
    container_name: vps-ninja-alertmanager
    restart: unless-stopped
    ports:
      - '9093:9093'
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    networks:
      - monitoring

  node-exporter:
    image: prom/node-exporter:latest
    container_name: vps-ninja-node-exporter
    restart: unless-stopped
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
    networks:
      - monitoring

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: vps-ninja-cadvisor
    restart: unless-stopped
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    networks:
      - monitoring

networks:
  monitoring:
    driver: bridge

volumes:
  prometheus_data:
  grafana_data:
COMPOSE"

    run_remote "cd /opt/monitoring && docker compose up -d"

    log_info "Step 5/5: Verifying..."
    sleep 5

    PROMETHEUS_OK=$(run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:9090/-/healthy 2>/dev/null" || echo "000")
    GRAFANA_OK=$(run_remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health 2>/dev/null" || echo "000")

    log_info "Prometheus: HTTP $PROMETHEUS_OK"
    log_info "Grafana: HTTP $GRAFANA_OK"

    echo "{\"status\": \"enabled\", \"prometheus\": \"http://$SERVER_HOST:9090\", \"grafana\": \"http://$SERVER_HOST:3001\", \"grafana_password\": \"vpsninja2026\"}"
    ;;

  disable)
    log_info "Removing monitoring stack from $SERVER"
    run_remote "cd /opt/monitoring && docker compose down -v 2>/dev/null; rm -rf /opt/monitoring"
    log_info "Monitoring stack removed"
    echo '{"status": "disabled"}'
    ;;

  status)
    log_info "Monitoring status on $SERVER"
    require_server "$SERVER"

    run_remote "
      echo '=== Monitoring Containers ==='
      docker ps --filter 'name=vps-ninja-' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null

      echo ''
      echo '=== Prometheus Targets ==='
      curl -s http://localhost:9090/api/v1/targets 2>/dev/null | jq -r '.data.activeTargets[] | \"\(.labels.job): \(.health)\"' 2>/dev/null || echo 'Prometheus not running'

      echo ''
      echo '=== Active Alerts ==='
      curl -s http://localhost:9090/api/v1/alerts 2>/dev/null | jq -r '.data.alerts[] | \"\(.labels.alertname): \(.state)\"' 2>/dev/null || echo 'No active alerts'
    "
    ;;

  alert)
    CHANNEL="${3:?Missing channel (slack/telegram/discord/webhook)}"
    URL="${4:?Missing webhook URL}"

    log_info "Configuring alert channel: $CHANNEL → $URL"
    require_server "$SERVER"

    # Update alertmanager config with webhook
    run_remote "
      cat > /opt/monitoring/alertmanager/alertmanager.yml << AMCFG
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'webhook'

receivers:
  - name: 'webhook'
    webhook_configs:
      - url: '$URL'
        send_resolved: true
AMCFG

      docker restart vps-ninja-alertmanager 2>/dev/null
    "

    log_info "Alert channel configured. Alerts will be sent to $CHANNEL"
    echo "{\"status\": \"configured\", \"channel\": \"$CHANNEL\"}"
    ;;

  query)
    PROMQL="${3:?Missing PromQL query}"
    require_server "$SERVER"

    log_debug "PromQL: $PROMQL"
    run_remote "curl -s 'http://localhost:9090/api/v1/query?query=$(echo "$PROMQL" | jq -Rs . | tr -d '\"')' 2>/dev/null" | jq '.data.result' 2>/dev/null || die "Prometheus query failed" 2
    ;;

  dashboard)
    require_server "$SERVER"
    echo "{\"grafana_url\": \"http://$SERVER_HOST:3001\", \"prometheus_url\": \"http://$SERVER_HOST:9090\", \"credentials\": {\"user\": \"admin\", \"password\": \"vpsninja2026\"}}"
    ;;

  *)
    die "Unknown action: $ACTION. Use: enable, disable, status, alert, query, dashboard" 1
    ;;
esac
