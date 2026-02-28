# Troubleshooting Guide

Quick reference for common issues and their solutions. Check here before searching the web.

---

## Table of Contents

1. [Build Failures](#build-failures)
2. [SSL / Let's Encrypt](#ssl--lets-encrypt)
3. [DNS Issues](#dns-issues)
4. [Application Not Responding](#application-not-responding)
5. [Database Issues](#database-issues)
6. [Auto-Deploy Not Working](#auto-deploy-not-working)
7. [SSH Connection Issues](#ssh-connection-issues)
8. [Dokploy Panel Issues](#dokploy-panel-issues)

---

## Build Failures

### Diagnosing

```bash
# Get latest deployment status and logs
RESPONSE=$(bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<appId>")
DEPLOYMENT_ID=$(echo "$RESPONSE" | jq -r '.[0].deploymentId')
STATUS=$(echo "$RESPONSE" | jq -r '.[0].status')

# Get build logs
bash scripts/dokploy-api.sh <server> GET "deployment.logsByDeployment?deploymentId=$DEPLOYMENT_ID"
```

### Common errors

| Error in logs | Cause | Fix |
|:-------------|:------|:----|
| `npm ERR! 404` | Private npm package | Check package.json, remove or make public |
| `Error: Cannot find module` | Missing dependency | Add to dependencies (not devDependencies) |
| `ECONNREFUSED :5432` | Database unavailable | Check DATABASE_URL, ensure DB is running |
| `Permission denied` | Dockerfile USER issue | Check Dockerfile permissions |
| `Out of memory` / `Killed` | Not enough RAM during build | Create swap (`/vps setup` does this) or build locally |
| `Port already in use` | Port conflict | Change port in app config or env |
| `fatal: could not read from remote repository` | Private repo without access | Install GitHub App or use PAT |
| `error: could not read Username` | Git auth failed | Repository URL or credentials wrong |
| `COPY failed: file not found` | Wrong Dockerfile context | Check `dockerContextPath` in buildType config |

### Actions after build failure

1. Read the last 50 lines of build logs
2. Identify the error from the table above
3. Suggest the specific fix
4. After fix, trigger redeploy: `application.redeploy`

---

## SSL / Let's Encrypt

### Certificate not issuing

**Diagnosis:**
```bash
# 1. Check DNS resolves to server IP
dig <domain> +short @1.1.1.1

# 2. Check ports 80/443 are open
bash scripts/ssh-exec.sh <server> "ufw status | grep -E '80|443'"

# 3. Check CloudFlare proxy is OFF (required for HTTP challenge)
bash scripts/cloudflare-dns.sh get <domain>
# proxied must be false
```

**Fix sequence:**
```bash
# 1. Ensure DNS without proxy
bash scripts/cloudflare-dns.sh create <domain> <server-ip> --no-proxy

# 2. Wait for DNS propagation
sleep 30

# 3. Restart Traefik to retry ACME challenge
bash scripts/ssh-exec.sh <server> "docker restart dokploy-traefik"

# 4. Wait for certificate (up to 60s)
sleep 60

# 5. Verify HTTPS
curl -sI "https://<domain>" | head -5
```

**Common SSL errors:**
| Traefik log message | Cause | Fix |
|:-------------------|:------|:----|
| `acme: error 403` | CloudFlare proxy intercepting | Disable proxy, wait 5 min, restart Traefik |
| `DNS problem: NXDOMAIN` | DNS record missing/not propagated | Check CloudFlare, wait longer |
| `connection refused` | Port 80 blocked | `ufw allow 80/tcp` |
| `too many certificates` | Let's Encrypt rate limit | Wait 1 hour, try again |

**After certificate is issued:**
```bash
# Enable CloudFlare proxy for CDN/DDoS protection
bash scripts/cloudflare-dns.sh create <domain> <server-ip> true
```

---

## DNS Issues

### Record not resolving

```bash
# Check what DNS returns
dig <domain> +short @1.1.1.1
dig <domain> +short @8.8.8.8

# Compare with expected server IP
jq -r '.servers.<server>.host' config/servers.json
```

### CloudFlare API errors

| Error | Cause | Fix |
|:------|:------|:----|
| `Zone not found` | Domain not in CloudFlare account | Add domain to CloudFlare first |
| `Authentication error` | Invalid API token | Regenerate token, update config |
| `Record already exists` | Duplicate A record | Script handles this (updates existing) |

---

## Application Not Responding

### Diagnosis steps

```bash
# 1. Check if application container is running
bash scripts/ssh-exec.sh <server> "docker service ls | grep <app-name>"

# 2. Check container logs
bash scripts/ssh-exec.sh <server> "docker service logs <app-name> --tail 50 2>&1"

# 3. Check if port is correct
bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq '.domains'
```

### Common causes

| Symptom | Likely cause | Fix |
|:--------|:------------|:----|
| Container keeps restarting | App crashes on startup | Check env vars, DB connection |
| 502 Bad Gateway | Wrong port in domain config | Update domain port to match app |
| Connection timeout | Firewall blocking | Check UFW, ensure port is allowed |
| App starts but no response | Listening on localhost only | App must listen on `0.0.0.0` |

---

## Database Issues

### Can't connect from application

```bash
# Check DB is running
bash scripts/dokploy-api.sh <server> GET "postgres.one?postgresId=<id>" | jq '.applicationStatus'

# Get internal URL (for apps on same server)
bash scripts/dokploy-api.sh <server> GET "postgres.one?postgresId=<id>" | jq '.internalDatabaseUrl'
```

**Use internal URL** for apps on the same server (uses Docker network).
**Use external URL** only for local development access.

---

## Auto-Deploy Not Working

See `references/github-app-autodeploy.md` for detailed troubleshooting.

Quick checklist:
1. GitHub App installed in Dokploy? (`Settings > Server > GitHub`)
2. Repository has access in GitHub App settings?
3. `autoDeploy` flag is `true`?
4. Pushing to the correct branch (the one configured in Dokploy)?

---

## SSH Connection Issues

| Error | Cause | Fix |
|:------|:------|:----|
| `Connection timed out` | Wrong IP or port 22 blocked | Verify IP, check provider firewall |
| `Permission denied` | Wrong password or key | Check credentials in config |
| `sshpass not found` | Missing dependency | `brew install sshpass` (macOS) or `apt install sshpass` |
| `Host key verification failed` | Known hosts mismatch | Scripts use `-o StrictHostKeyChecking=no` |

---

## Dokploy Panel Issues

### Panel not accessible

```bash
# Check if Dokploy container is running
bash scripts/ssh-exec.sh <server> "docker service ls | grep dokploy"

# Check Dokploy logs
bash scripts/ssh-exec.sh <server> "docker service logs dokploy --tail 30 2>&1"

# Restart Dokploy
bash scripts/ssh-exec.sh <server> "docker service update --force dokploy"
```

### API returns 401/403

API key might be expired or invalid. User needs to:
1. Log into Dokploy UI
2. Settings > Profile > API/CLI
3. Generate new API key
4. Update config: `/vps config server add <name> <ip>` (re-add with new key)
