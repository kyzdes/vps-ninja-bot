#!/bin/bash
# VPS Server Setup Template
# This script is run on the VPS during /vps setup command
# It performs basic server hardening and prepares for Dokploy installation

set -euo pipefail

echo "=== VPS Ninja Server Setup ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: This script must be run as root"
  exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  OS_VERSION=$VERSION_ID
else
  echo "Error: Cannot detect OS"
  exit 1
fi

echo "Detected OS: $OS $OS_VERSION"

# Update system packages
echo "Updating system packages..."
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  apt update
  DEBIAN_FRONTEND=noninteractive apt upgrade -y
elif [ "$OS" = "centos" ] || [ "$OS" = "fedora" ]; then
  yum update -y
else
  echo "Warning: Unsupported OS for automatic updates"
fi

# Install essential packages
echo "Installing essential packages..."
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  apt install -y curl wget git ufw fail2ban unattended-upgrades
elif [ "$OS" = "centos" ] || [ "$OS" = "fedora" ]; then
  yum install -y curl wget git firewalld fail2ban
fi

# Configure firewall
echo "Configuring firewall..."
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp comment 'SSH'
  ufw allow 80/tcp comment 'HTTP'
  ufw allow 443/tcp comment 'HTTPS'
  ufw allow 3000/tcp comment 'Dokploy'
  ufw --force enable
  ufw status
elif [ "$OS" = "centos" ] || [ "$OS" = "fedora" ]; then
  systemctl start firewalld
  systemctl enable firewalld
  firewall-cmd --permanent --add-service=ssh
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --permanent --add-port=3000/tcp
  firewall-cmd --reload
fi

# Configure fail2ban
echo "Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# Configure swap (if RAM < 4GB)
TOTAL_RAM=$(free -m | grep Mem | awk '{print $2}')
if [ "$TOTAL_RAM" -lt 4096 ]; then
  echo "RAM is ${TOTAL_RAM}MB (< 4GB). Creating 2GB swap..."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    swapon --show
  else
    echo "Swap file already exists"
  fi
fi

# Configure unattended upgrades (Ubuntu/Debian only)
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
  echo "Configuring automatic security updates..."
  cat > /etc/apt/apt.conf.d/50unattended-upgrades <<EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  systemctl enable unattended-upgrades
fi

# System info
echo ""
echo "=== System Information ==="
echo "OS: $OS $OS_VERSION"
echo "Kernel: $(uname -r)"
echo "RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $2}')"
echo "Swap: $(swapon --show | tail -1 | awk '{print $3}' || echo 'None')"
echo ""
echo "=== Setup Complete ==="
echo "Next step: Install Dokploy"
