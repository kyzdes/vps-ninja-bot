#!/bin/bash
# Security audit and vulnerability scanning
# Usage:
#   security-scan.sh server  <server>                 # Full server security audit
#   security-scan.sh deps    <server> <project-dir>   # Dependency vulnerability scan
#   security-scan.sh ports   <server>                 # Open ports scan
#   security-scan.sh docker  <server>                 # Docker security check
#   security-scan.sh ssh     <server>                 # SSH hardening check
#   security-scan.sh ssl     <domain>                 # SSL/TLS security grade
#
# Exit codes: 0 = secure, 1 = config error, 2 = vulnerabilities found

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq curl

ACTION="${1:?Usage: security-scan.sh <server|deps|ports|docker|ssh|ssl> ...}"

SSH_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ssh-exec.sh"

run_remote() {
  bash "$SSH_SCRIPT" "$1" "$2"
}

ISSUES=0
WARNINGS=0

check_pass() { echo "  [PASS] $1"; }
check_warn() { echo "  [WARN] $1"; WARNINGS=$((WARNINGS + 1)); }
check_fail() { echo "  [FAIL] $1"; ISSUES=$((ISSUES + 1)); }

case "$ACTION" in
  server)
    SERVER="${2:?Missing server name}"
    log_info "Running full security audit on $SERVER"

    echo "=== SSH Security ==="
    # Check root login
    ROOT_LOGIN=$(run_remote "$SERVER" "grep -E '^PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null | awk '{print \$2}'" || echo "unknown")
    case "$ROOT_LOGIN" in
      no|prohibit-password) check_pass "Root login: $ROOT_LOGIN" ;;
      yes) check_fail "Root login enabled (set PermitRootLogin to 'prohibit-password')" ;;
      *) check_warn "Root login config unclear: $ROOT_LOGIN" ;;
    esac

    # Check password auth
    PASS_AUTH=$(run_remote "$SERVER" "grep -E '^PasswordAuthentication' /etc/ssh/sshd_config 2>/dev/null | awk '{print \$2}'" || echo "unknown")
    case "$PASS_AUTH" in
      no) check_pass "Password auth disabled" ;;
      yes) check_warn "Password auth enabled (consider SSH keys only)" ;;
      *) check_warn "Password auth config unclear" ;;
    esac

    # Check SSH port
    SSH_PORT=$(run_remote "$SERVER" "grep -E '^Port ' /etc/ssh/sshd_config 2>/dev/null | awk '{print \$2}'" || echo "22")
    [ "$SSH_PORT" = "22" ] && check_warn "SSH on default port 22 (consider changing)" || check_pass "SSH on non-default port: $SSH_PORT"

    echo ""
    echo "=== Firewall ==="
    UFW_STATUS=$(run_remote "$SERVER" "ufw status 2>/dev/null | head -1" || echo "unknown")
    if echo "$UFW_STATUS" | grep -q "active"; then
      check_pass "UFW firewall active"
    else
      check_fail "Firewall not active!"
    fi

    echo ""
    echo "=== Fail2ban ==="
    F2B_STATUS=$(run_remote "$SERVER" "systemctl is-active fail2ban 2>/dev/null" || echo "inactive")
    [ "$F2B_STATUS" = "active" ] && check_pass "fail2ban active" || check_warn "fail2ban not running"

    BANNED=$(run_remote "$SERVER" "fail2ban-client status sshd 2>/dev/null | grep 'Currently banned' | awk '{print \$NF}'" || echo "0")
    log_info "Currently banned IPs: $BANNED"

    echo ""
    echo "=== System Updates ==="
    UPDATES=$(run_remote "$SERVER" "apt list --upgradable 2>/dev/null | grep -c 'upgradable' || echo 0" || echo "unknown")
    [ "$UPDATES" = "0" ] && check_pass "System up to date" || check_warn "$UPDATES packages can be upgraded"

    SECURITY_UPDATES=$(run_remote "$SERVER" "apt list --upgradable 2>/dev/null | grep -c security || echo 0" || echo "0")
    [ "$SECURITY_UPDATES" != "0" ] && check_fail "$SECURITY_UPDATES security updates pending!" || check_pass "No pending security updates"

    echo ""
    echo "=== Unattended Upgrades ==="
    AUTO_UPGRADES=$(run_remote "$SERVER" "systemctl is-enabled unattended-upgrades 2>/dev/null" || echo "disabled")
    [ "$AUTO_UPGRADES" = "enabled" ] && check_pass "Automatic security updates enabled" || check_warn "Automatic updates not enabled"

    echo ""
    echo "=== Open Ports ==="
    run_remote "$SERVER" "ss -tlnp | grep LISTEN | awk '{print \$4, \$6}' | head -20"

    echo ""
    echo "=== Docker Security ==="
    DOCKER_ROOT=$(run_remote "$SERVER" "docker info 2>/dev/null | grep 'Root Dir'" || echo "unknown")
    log_info "Docker root: $DOCKER_ROOT"

    PRIVILEGED=$(run_remote "$SERVER" "docker ps --format '{{.Names}}' --filter 'status=running' | while read c; do docker inspect \$c 2>/dev/null | jq -r '.[0].HostConfig.Privileged' | grep true && echo \$c; done" || echo "")
    [ -z "$PRIVILEGED" ] && check_pass "No privileged containers" || check_fail "Privileged containers found: $PRIVILEGED"

    echo ""
    echo "=== Summary ==="
    echo "  Issues:   $ISSUES"
    echo "  Warnings: $WARNINGS"
    if [ "$ISSUES" -gt 0 ]; then
      echo "  Status:   VULNERABILITIES FOUND"
      exit 2
    elif [ "$WARNINGS" -gt 0 ]; then
      echo "  Status:   HARDENING RECOMMENDED"
    else
      echo "  Status:   SECURE"
    fi
    echo "{\"issues\": $ISSUES, \"warnings\": $WARNINGS}"
    ;;

  deps)
    SERVER="${2:?Missing server name}"
    PROJECT_DIR="${3:?Missing project directory}"

    log_info "Scanning dependencies in $PROJECT_DIR"

    run_remote "$SERVER" "
      cd $PROJECT_DIR 2>/dev/null || exit 1

      echo '=== Package Manager Audit ==='
      if [ -f package-lock.json ] || [ -f package.json ]; then
        echo '--- npm audit ---'
        npm audit --json 2>/dev/null | jq '{vulnerabilities: .metadata.vulnerabilities}' 2>/dev/null || npm audit 2>/dev/null || echo 'npm audit unavailable'
      fi

      if [ -f yarn.lock ]; then
        echo '--- yarn audit ---'
        yarn audit --json 2>/dev/null | head -5 || echo 'yarn audit unavailable'
      fi

      if [ -f requirements.txt ]; then
        echo '--- pip audit ---'
        pip audit 2>/dev/null || pip-audit 2>/dev/null || echo 'pip-audit not installed (pip install pip-audit)'
      fi

      if [ -f Gemfile.lock ]; then
        echo '--- bundle audit ---'
        bundle audit check 2>/dev/null || echo 'bundler-audit not installed'
      fi

      if [ -f go.sum ]; then
        echo '--- govulncheck ---'
        govulncheck ./... 2>/dev/null || echo 'govulncheck not installed'
      fi
    "
    ;;

  ports)
    SERVER="${2:?Missing server name}"
    log_info "Port scan on $SERVER"

    require_server "$SERVER"

    echo "=== External Port Scan ==="
    for port in 22 80 443 3000 3001 5432 6379 8080 9090 9093 27017; do
      RESULT=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://$SERVER_HOST:$port/" 2>/dev/null || echo "closed")
      if [ "$RESULT" != "000" ] && [ "$RESULT" != "closed" ]; then
        echo "  Port $port: OPEN (HTTP $RESULT)"
      else
        # Try TCP connect
        timeout 3 bash -c "echo >/dev/tcp/$SERVER_HOST/$port" 2>/dev/null && echo "  Port $port: OPEN" || echo "  Port $port: closed"
      fi
    done

    echo ""
    echo "=== Internal Listening Ports ==="
    run_remote "$SERVER" "ss -tlnp | grep LISTEN | sort -t: -k2 -n"
    ;;

  docker)
    SERVER="${2:?Missing server name}"
    log_info "Docker security check on $SERVER"

    run_remote "$SERVER" "
      echo '=== Docker Daemon ==='
      docker info 2>/dev/null | grep -E '(Server Version|Storage Driver|Logging Driver|Security Options)'

      echo ''
      echo '=== Container Security ==='
      docker ps --format '{{.Names}}' | while read container; do
        PRIV=\$(docker inspect \$container 2>/dev/null | jq -r '.[0].HostConfig.Privileged')
        NET=\$(docker inspect \$container 2>/dev/null | jq -r '.[0].HostConfig.NetworkMode')
        PID=\$(docker inspect \$container 2>/dev/null | jq -r '.[0].HostConfig.PidMode')
        USER=\$(docker inspect \$container 2>/dev/null | jq -r '.[0].Config.User')

        FLAGS=''
        [ \"\$PRIV\" = 'true' ] && FLAGS=\"\${FLAGS} PRIVILEGED\"
        [ \"\$NET\" = 'host' ] && FLAGS=\"\${FLAGS} HOST-NET\"
        [ \"\$PID\" = 'host' ] && FLAGS=\"\${FLAGS} HOST-PID\"
        [ -z \"\$USER\" ] || [ \"\$USER\" = 'root' ] && FLAGS=\"\${FLAGS} ROOT-USER\"

        if [ -n \"\$FLAGS\" ]; then
          echo \"  [WARN] \$container:\$FLAGS\"
        else
          echo \"  [OK]   \$container\"
        fi
      done

      echo ''
      echo '=== Docker Images ==='
      echo 'Outdated images (pulled > 30 days ago):'
      docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | grep -E '(months|year)' | head -10

      echo ''
      echo 'Dangling images:'
      DANGLING=\$(docker images -f 'dangling=true' -q | wc -l)
      echo \"  Count: \$DANGLING\"
      [ \"\$DANGLING\" -gt 5 ] && echo '  Run: docker image prune -f'
    "
    ;;

  ssh)
    SERVER="${2:?Missing server name}"
    log_info "SSH hardening check on $SERVER"

    run_remote "$SERVER" "
      echo '=== SSH Configuration ==='
      grep -E '^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|X11Forwarding|MaxAuthTries|Protocol|AllowUsers|AllowGroups|Port|PermitEmptyPasswords)' /etc/ssh/sshd_config 2>/dev/null || echo 'Cannot read sshd_config'

      echo ''
      echo '=== Authorized Keys ==='
      for user_home in /root /home/*; do
        [ -f \"\$user_home/.ssh/authorized_keys\" ] && echo \"  \$(basename \$user_home): \$(wc -l < \$user_home/.ssh/authorized_keys) key(s)\"
      done

      echo ''
      echo '=== Recent Failed Logins ==='
      lastb 2>/dev/null | head -10 || journalctl -u sshd --since '24 hours ago' 2>/dev/null | grep -i 'failed' | tail -10

      echo ''
      echo '=== SSH Ciphers ==='
      ssh -Q cipher 2>/dev/null | head -10
    "
    ;;

  ssl)
    DOMAIN="${2:?Missing domain}"
    log_info "SSL/TLS security check for $DOMAIN"

    require_cmd openssl
    validate_domain "$DOMAIN" || die "Invalid domain: $DOMAIN" 1

    echo "=== Certificate Info ==="
    echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -text 2>/dev/null | grep -E "(Issuer:|Subject:|Not Before|Not After|DNS:|Signature Algorithm)" || {
      die "Cannot connect to $DOMAIN:443" 2
    }

    echo ""
    echo "=== Protocol Support ==="
    for proto in tls1 tls1_1 tls1_2 tls1_3; do
      RESULT=$(echo | openssl s_client -"$proto" -connect "$DOMAIN:443" 2>/dev/null | head -1)
      if echo "$RESULT" | grep -q "CONNECTED"; then
        case "$proto" in
          tls1|tls1_1) check_warn "$proto supported (should be disabled)" ;;
          tls1_2|tls1_3) check_pass "$proto supported" ;;
        esac
      else
        case "$proto" in
          tls1|tls1_1) check_pass "$proto disabled" ;;
          tls1_3) check_warn "$proto not supported (recommended)" ;;
          *) log_info "$proto: not supported" ;;
        esac
      fi
    done

    echo ""
    echo "=== Security Headers ==="
    HEADERS=$(curl -s -I "https://$DOMAIN" --max-time 10 2>/dev/null)
    for header in "Strict-Transport-Security" "X-Content-Type-Options" "X-Frame-Options" "Content-Security-Policy" "X-XSS-Protection"; do
      if echo "$HEADERS" | grep -qi "$header"; then
        check_pass "$header present"
      else
        check_warn "$header missing"
      fi
    done

    echo ""
    echo "=== Summary ==="
    echo "  Issues: $ISSUES  Warnings: $WARNINGS"
    ;;

  *)
    die "Unknown action: $ACTION. Use: server, deps, ports, docker, ssh, ssl" 1
    ;;
esac
