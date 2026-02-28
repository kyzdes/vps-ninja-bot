# VPS Setup: 185.22.64.10

Setting up VPS at `185.22.64.10` with Dokploy...

## Step 1: SSH Access

Connecting to `185.22.64.10` via SSH...

Server is reachable. OS detected: **Ubuntu 22.04 LTS** (x86_64).

## Step 2: Resource Check

| Resource | Available | Required | Status |
|----------|-----------|----------|--------|
| RAM | 4096 MB | 2048 MB | OK |
| Disk | 80 GB | 30 GB | OK |

Resources are sufficient. Proceeding.

## Step 3: System Update

Updating system packages... Done. All packages are up to date.

## Step 4: Firewall (UFW)

Firewall configured and enabled:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3000 | TCP | Dokploy UI |

## Step 5: Dokploy Installation

Installing Dokploy... This takes 3-5 minutes.

- Docker: Installed
- Docker Swarm: Initialized
- Network `dokploy-network`: Created
- Containers deployed: Dokploy, PostgreSQL, Redis, Traefik

## Step 6: Readiness Check

Waiting for Dokploy to start... Dokploy is accessible at `http://185.22.64.10:3000`.

## Step 7: Create Admin Account

Dokploy is installed and running!

**Now you need to create an admin account:**

1. Open in your browser: **http://185.22.64.10:3000**
2. Create an account (email + password)
3. After logging in, go to: **Settings -> Profile -> API/CLI**
4. Click **"Generate API Key"**
5. Copy the API key and paste it here

> I will wait for your API key to continue. After receiving it, I will validate it, save the server configuration, and complete the setup.

## What Happens Next (after you provide the API key)

**Step 8:** I will verify the API key by calling the Dokploy API and checking the installed version.

**Step 9:** I will save the server as `"vps2"` in the configuration (since `"main"` is already taken by your existing server at 77.90.43.8).

**Step 10:** I will offer optional improvements:
- **Swap** (2 GB) -- recommended for stability
- **Fail2ban** -- brute-force protection for SSH
- **Unattended upgrades** -- automatic security patches

## Final Report (preview)

```
Server "vps2" is set up and ready!

Details:
  IP: 185.22.64.10
  Dokploy URL: http://185.22.64.10:3000
  SSH: root@185.22.64.10
  Firewall: UFW (22, 80, 443, 3000)

Next steps:
  1. Deploy a project: /vps deploy <github-url> --domain <domain>
  2. Set as default server: /vps config default vps2

Security recommendations:
  - Set up SSH key: ssh-copy-id root@185.22.64.10
  - Disable password auth: PermitRootLogin prohibit-password
  - Close port 3000 after setting up a domain for the Dokploy panel
```
