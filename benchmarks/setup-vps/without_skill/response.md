# VPS Setup Plan for 185.22.64.10 with Dokploy

Below is a complete plan for setting up a fresh VPS at `185.22.64.10` with Dokploy for hosting. Since I was instructed not to execute SSH commands against the live server, this document provides the exact steps and commands you would run.

---

## Overview

**Dokploy** is an open-source, self-hosted deployment platform (similar to Vercel/Netlify but on your own server). It uses Docker Swarm under the hood and provides a web UI for deploying applications, managing databases, configuring domains, and handling SSL certificates via Traefik.

**Server:** 185.22.64.10
**Credentials:** root / MyR00tPass456
**Goal:** Install Dokploy and configure the server for production hosting.

---

## Step 1: Connect to the Server

```bash
ssh root@185.22.64.10
# Enter password: MyR00tPass456
```

---

## Step 2: Update the System

Ensure all packages are up to date before installing anything:

```bash
apt update && apt upgrade -y
```

---

## Step 3: Configure the Firewall (UFW)

Set up UFW to allow only necessary traffic. **Important:** Allow SSH first before enabling the firewall to avoid locking yourself out.

```bash
# Install UFW if not present
apt install ufw -y

# Allow required ports
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (Traefik)
ufw allow 443/tcp    # HTTPS (Traefik)
ufw allow 3000/tcp   # Dokploy web interface (temporary)

# Enable the firewall
ufw enable

# Verify
ufw status
```

---

## Step 4: Install Dokploy

Run the official Dokploy installation script. This will automatically install Docker (if not already present), initialize Docker Swarm mode, and deploy Dokploy as a Docker service:

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

The installation typically takes 3-5 minutes. It handles:
- Docker Engine installation
- Docker Swarm initialization
- Dokploy container deployment
- Traefik reverse proxy setup

After installation, verify it is running:

```bash
docker ps
```

You should see Dokploy and Traefik containers running.

---

## Step 5: Access the Dokploy Web Interface

Open your browser and navigate to:

```
http://185.22.64.10:3000
```

You will be presented with the initial setup page where you need to:

1. **Create an admin account** -- set a strong username and password
2. This account will be used to manage all deployments going forward

---

## Step 6: Configure a Domain and HTTPS

Once logged into the Dokploy dashboard:

1. Go to **Settings** in the Dokploy UI
2. Add your domain (e.g., `panel.yourdomain.com`)
3. Create a DNS **A record** pointing your domain to `185.22.64.10`
4. Enable HTTPS -- Dokploy uses Traefik with automatic Let's Encrypt certificate provisioning
5. Configure the Let's Encrypt email address for certificate notifications

---

## Step 7: Secure the Installation

### 7a. Close Port 3000 After HTTPS is Configured

Once you have HTTPS working on your custom domain, close the direct port 3000 access:

```bash
ufw delete allow 3000/tcp
```

And remove the published port from the Docker service:

```bash
docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy
```

**Warning:** Only do this AFTER confirming your HTTPS domain access works, or you will lose access to the panel.

### 7b. SSH Hardening (Recommended)

Create a non-root user and set up SSH key authentication:

```bash
# Create a deploy user
adduser deploy
usermod -aG sudo deploy

# Switch to the new user and set up SSH keys
su - deploy
mkdir -p ~/.ssh
chmod 700 ~/.ssh
# Add your public key:
echo "your-public-ssh-key-here" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Then harden the SSH configuration by editing `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers deploy
```

Restart SSH:

```bash
systemctl restart sshd
```

**Critical:** Test SSH access with the new user in a separate terminal BEFORE closing your current session.

### 7c. Install Fail2Ban

Protect against brute-force attacks:

```bash
apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban
```

The default configuration will ban IPs after 5 failed SSH login attempts within 10 minutes.

### 7d. Enable Automatic Security Updates

```bash
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

---

## Step 8: Verify Everything Works

1. Access Dokploy via your HTTPS domain (e.g., `https://panel.yourdomain.com`)
2. Log in with your admin credentials
3. Try deploying a test application to confirm the pipeline works
4. Verify SSL certificate is valid in the browser

---

## System Requirements Recap

| Requirement | Minimum | Recommended |
|---|---|---|
| RAM | 2 GB | 4 GB+ |
| CPU | 1 vCPU | 2 vCPU+ |
| Disk | 30 GB SSD | 50 GB+ SSD |
| OS | Ubuntu 20.04+ / Debian 11+ | Ubuntu 24.04 LTS |
| Ports | 22, 80, 443, 3000 (temp) | Same |

---

## Summary of Commands (Quick Reference)

```bash
# 1. Connect
ssh root@185.22.64.10

# 2. Update system
apt update && apt upgrade -y

# 3. Firewall
apt install ufw -y
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw enable

# 4. Install Dokploy
curl -sSL https://dokploy.com/install.sh | sh

# 5. Access: http://185.22.64.10:3000
# 6. Configure domain + HTTPS in UI

# 7. Post-setup security
ufw delete allow 3000/tcp
apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban
```

---

## Important Notes

- Dokploy consumes roughly 300-400 MB of RAM at idle, so a 2 GB RAM server is the practical minimum.
- The installation script initializes Docker Swarm mode -- this is required for Dokploy to function.
- Always back up your Dokploy configuration before updates. To update Dokploy: `curl -sSL https://dokploy.com/install.sh | sh -s update`
- If you need to use specific Docker Swarm network ranges (to avoid CIDR conflicts), set the `DOCKER_SWARM_INIT_ARGS` environment variable before installation.

---

## Sources

- [Dokploy Official Installation Docs](https://docs.dokploy.com/docs/core/installation)
- [RamNode Dokploy Setup Guide](https://ramnode.com/guides/dokploy)
- [MassiveGRID Dokploy Installation Guide](https://massivegrid.com/blog/how-to-install-dokploy-on-vps/)
- [MassiveGRID Securing Dokploy](https://massivegrid.com/blog/securing-your-dokploy-instance/)
- [Hetzner Community Dokploy Tutorial](https://community.hetzner.com/tutorials/setup-dokploy-on-your-vps/)
