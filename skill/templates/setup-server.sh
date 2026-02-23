#!/bin/bash
# VPS Server Setup Template (v2)
# This script is run on the VPS during /vps setup command
# Features: idempotent, progress reporting, better security, OS-aware

set -euo pipefail

STEP=0
TOTAL_STEPS=7

progress() {
  STEP=$((STEP + 1))
  echo ""
  echo "━━━ [$STEP/$TOTAL_STEPS] $1 ━━━"
}

ok()   { echo "  ✓ $1"; }
skip() { echo "  → $1 (skipped)"; }
warn() { echo "  ⚠ $1"; }

# ── Pre-flight checks ──

echo "═══════════════════════════════════"
echo "  VPS Ninja Server Setup v2"
echo "═══════════════════════════════════"

if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root"
  exit 1
fi

# ── Detect OS ──

progress "Detecting operating system"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_VERSION=$VERSION_ID
else
  echo "Error: Cannot detect OS (/etc/os-release not found)"
  exit 1
fi

IS_DEBIAN=false
IS_RHEL=false
case "$OS" in
  ubuntu|debian) IS_DEBIAN=true ;;
  centos|fedora|rhel|rocky|alma) IS_RHEL=true ;;
esac

ok "Detected: $OS $OS_VERSION"

# System info
RAM_MB=$(free -m | grep Mem | awk '{print $2}')
DISK_GB=$(df -BG / | tail -1 | awk '{print $2}' | tr -d 'G')
CORES=$(nproc)
ok "Hardware: ${CORES} cores, ${RAM_MB}MB RAM, ${DISK_GB}GB disk"

if [ "$RAM_MB" -lt 1024 ]; then
  warn "Very low RAM ($RAM_MB MB). Minimum recommended: 2048 MB"
fi

# ── Update system ──

progress "Updating system packages"

if $IS_DEBIAN; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get upgrade -y -qq
  ok "APT packages updated"
elif $IS_RHEL; then
  yum update -y -q
  ok "YUM packages updated"
else
  warn "Unsupported OS for automatic updates: $OS"
fi

# ── Install essentials ──

progress "Installing essential packages"

if $IS_DEBIAN; then
  apt-get install -y -qq curl wget git jq ufw fail2ban unattended-upgrades > /dev/null 2>&1
  ok "Packages: curl, wget, git, jq, ufw, fail2ban, unattended-upgrades"
elif $IS_RHEL; then
  yum install -y -q curl wget git jq firewalld fail2ban > /dev/null 2>&1
  ok "Packages: curl, wget, git, jq, firewalld, fail2ban"
fi

# ── Configure firewall (idempotent) ──

progress "Configuring firewall"

if $IS_DEBIAN; then
  # Check if UFW is already configured with our rules
  if ufw status 2>/dev/null | grep -q "22/tcp.*ALLOW"; then
    skip "UFW already configured"
  else
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment 'SSH'
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    ufw allow 3000/tcp comment 'Dokploy Panel'
    ufw --force enable
    ok "UFW configured (22, 80, 443, 3000)"
  fi
  ufw status | grep -E "^[0-9]" | head -10
elif $IS_RHEL; then
  systemctl start firewalld 2>/dev/null || true
  systemctl enable firewalld 2>/dev/null || true
  firewall-cmd --permanent --add-service=ssh 2>/dev/null || true
  firewall-cmd --permanent --add-service=http 2>/dev/null || true
  firewall-cmd --permanent --add-service=https 2>/dev/null || true
  firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
  firewall-cmd --reload
  ok "firewalld configured (ssh, http, https, 3000)"
fi

# ── Configure fail2ban (idempotent) ──

progress "Configuring fail2ban"

if systemctl is-active fail2ban &>/dev/null; then
  skip "fail2ban already running"
else
  # Create SSH jail config
  cat > /etc/fail2ban/jail.d/sshd.conf <<'JAIL'
[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 5
bantime = 3600
findtime = 600
JAIL
  systemctl enable fail2ban
  systemctl restart fail2ban
  ok "fail2ban enabled (SSH: 5 retries, 1h ban)"
fi

# ── Configure swap (idempotent) ──

progress "Configuring swap"

if [ "$RAM_MB" -lt 4096 ]; then
  if swapon --show | grep -q "/swapfile"; then
    skip "Swap already configured"
    swapon --show
  else
    SWAP_SIZE="2G"
    if [ "$RAM_MB" -lt 2048 ]; then
      SWAP_SIZE="4G"
    fi
    echo "  Creating ${SWAP_SIZE} swap file..."
    fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$((${SWAP_SIZE%G} * 1024)) status=progress
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    # Idempotent fstab entry
    if ! grep -q "/swapfile" /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    # Optimize swappiness for servers
    sysctl vm.swappiness=10
    if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
      echo 'vm.swappiness=10' >> /etc/sysctl.conf
    fi
    ok "Swap: $SWAP_SIZE (swappiness=10)"
  fi
else
  skip "RAM >= 4GB, swap not needed"
fi

# ── Configure automatic security updates ──

progress "Configuring automatic security updates"

if $IS_DEBIAN; then
  cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'APT'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Package-Blacklist {
};
Unattended-Upgrade::DevRelease "false";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
APT

  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT2'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT2

  systemctl enable unattended-upgrades 2>/dev/null || true
  ok "Auto security updates enabled (security-only, no reboot)"
elif $IS_RHEL; then
  if command -v dnf &>/dev/null; then
    dnf install -y -q dnf-automatic 2>/dev/null || true
    sed -i 's/apply_updates = no/apply_updates = yes/' /etc/dnf/automatic.conf 2>/dev/null || true
    systemctl enable dnf-automatic.timer 2>/dev/null || true
    ok "DNF auto-updates enabled"
  fi
fi

# ── System tuning ──

# Increase file descriptors for Docker
if ! grep -q "fs.file-max" /etc/sysctl.conf; then
  cat >> /etc/sysctl.conf <<'SYSCTL'
# VPS Ninja tuning
fs.file-max = 65535
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
SYSCTL
  sysctl -p > /dev/null 2>&1
fi

# ── Final report ──

echo ""
echo "═══════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════"
echo ""
echo "  OS:        $OS $OS_VERSION"
echo "  Kernel:    $(uname -r)"
echo "  CPU:       $CORES cores"
echo "  RAM:       $(free -h | grep Mem | awk '{print $2}')"
echo "  Disk:      $(df -h / | tail -1 | awk '{print $2}')"
echo "  Swap:      $(swapon --show 2>/dev/null | tail -1 | awk '{print $3}' || echo 'None')"
echo "  Firewall:  Active"
echo "  Fail2ban:  Active"
echo "  Updates:   Auto (security-only)"
echo ""
echo "  Next: Install Dokploy"
echo "═══════════════════════════════════"
