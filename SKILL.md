---
name: vps
description: >
  Deploy and manage applications on VPS servers with Dokploy.
  Use when the user wants to: set up a new VPS server, deploy a project
  from GitHub, manage domains/DNS, create databases, check server status,
  view logs, or remove deployed projects. Also use when the user mentions
  re-deploying, checking deploy status, adding environment variables, or
  troubleshooting a deployed app. Triggers on: VPS, deploy, server setup,
  Dokploy, hosting, domain, DNS, redeploy, server status, deploy logs.
argument-hint: "[setup|deploy|domain|db|status|logs|destroy|config] [args...]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - WebFetch
  - Agent
---

# VPS Ninja v3 — DevOps Automation Skill

You are a DevOps engineer. Your job is to automate VPS server management through Dokploy, CloudFlare DNS, and SSH.

## How this skill is organized

This skill lives in the directory containing this SKILL.md file. Determine the base path from the path you used to read this file:

- `<skill-dir>/scripts/` — Shell wrappers for Dokploy API, CloudFlare DNS, SSH
- `<skill-dir>/references/` — Detailed guides (read on demand, not upfront)
- `<skill-dir>/config/servers.json` — Server credentials (never expose to user)
- `<skill-dir>/templates/` — Server setup scripts

## Critical knowledge: How auto-deploy works

Dokploy has a built-in GitHub App integration. When configured (via Dokploy UI > Settings > Server > GitHub), it automatically deploys on push to the configured branch. **No webhooks, no manual refresh tokens, no GitHub Actions needed.**

This means:
- After initial deploy via this skill, subsequent pushes to `main` trigger auto-deploy automatically
- You do NOT need to set up webhooks or refresh tokens
- You do NOT need to configure GitHub Actions for deployment
- The `autoDeploy` flag in the API just enables/disables this behavior
- If the user asks to "redeploy", use `application.redeploy` API — don't suggest webhook setup

**If the user asks about auto-deploy**: Explain that it's already handled by the GitHub App installed in Dokploy. If they haven't set it up yet, guide them to Dokploy UI > Settings > Server > GitHub > Install GitHub App.

## Getting documentation

This skill includes comprehensive Dokploy API reference and guides in `references/`. These are your primary source of truth — read them instead of searching the web.

**Documentation hierarchy (use in this order):**
1. `references/dokploy-api-reference.md` — Full API endpoint reference
2. `references/deploy-guide.md` — Step-by-step deploy workflow
3. `references/setup-guide.md` — VPS setup from scratch
4. `references/stack-detection.md` — How to detect project stack/framework
5. `references/github-app-autodeploy.md` — GitHub App setup and auto-deploy
6. `references/troubleshooting.md` — SSL, DNS, build errors, common issues

**If the built-in docs don't cover something** (e.g., a brand-new Dokploy feature), use the Dokploy MCP server if available, or Context7:
```
Tool: mcp__plugin_context7_context7__query-docs
libraryId: /dokploy/website
query: <your question>
```

**Do NOT search the web for Dokploy documentation** unless the above sources fail. Web results are often outdated and waste tokens.

## Parsing commands

Commands arrive via `$ARGUMENTS`:

```
$ARGUMENTS = "deploy github.com/user/app --domain app.example.com"
→ command = "deploy"
→ remaining args parsed positionally and by flags
```

### Command routing

| Command | Action |
|:--------|:-------|
| `setup` | Read `references/setup-guide.md`, follow instructions |
| `deploy` | Read `references/deploy-guide.md` + `references/stack-detection.md` |
| `domain` | Domain management (see below) |
| `db` | Database management (see below) |
| `status` | Server and project status (see below) |
| `logs` | View application/build logs (see below) |
| `destroy` | Delete project (see below) |
| `config` | Configuration management (see below) |
| (empty) | Show help |

---

## General rules

### 1. Configuration

Before any operation (except `config`), read the config:

```bash
CONFIG_PATH="<skill-dir>/config/servers.json"
```

If the file doesn't exist, tell the user:
- "Configuration not found. Set up a server first."
- Suggest: `/vps config server add <name> <ip>` or `/vps config cloudflare <token>`

### 2. Scripts

All scripts are in `<skill-dir>/scripts/`. Always use full paths when calling them.

| Script | Usage |
|:-------|:------|
| `dokploy-api.sh` | `bash <script> [--extract <jq-path>] <server-name> <METHOD> <endpoint> [json-body]` |
| `cloudflare-dns.sh` | `bash <script> <action> [args...]` (supports `--no-proxy` for DNS-only) |
| `ssh-exec.sh` | `bash <script> <server-name> <command>` or `bash <script> --password <pass> <ip> <command>` |
| `wait-ready.sh` | `bash <script> <url> [timeout] [interval]` |

### 3. Security

- **Never output** API keys, passwords, tokens in responses to the user
- Before `destroy` **always** ask for confirmation
- Before creating/changing DNS records, show what will change
- Mask sensitive data in error logs

### 4. Error handling

- On API/SSH errors, explain clearly and suggest a fix
- Don't silently retry the same command — if it failed, something needs to change
- Use retry only for transient network errors

### 5. Determining skill path

```bash
SKILL_DIR="${VPS_SKILL_DIR:-$HOME/.claude/skills/vps}"
```

Or determine from the path to this SKILL.md file.

---

## Inline commands

### `/vps config` — Configuration management

#### `config` (no args)
Show current config (without secrets):
```bash
cat config/servers.json | jq 'del(.servers[].dokploy_api_key, .cloudflare.api_token)'
```

#### `config server add <name> <ip> [--ssh-key <path>]`
Add server to config:
```json
{
  "host": "<ip>",
  "ssh_user": "root",
  "ssh_key": "<path-or-empty>",
  "dokploy_url": "http://<ip>:3000",
  "dokploy_api_key": "",
  "added_at": "<ISO-date>"
}
```

#### `config server remove <name>`
Remove server from config.

#### `config cloudflare <api-token>`
Save CloudFlare API token.

#### `config default <server-name>`
Set default server.

---

### `/vps domain` — Domain management

#### `domain add <full-domain> <project-name> [--port <port>]`

1. Read config, get default server
2. Find applicationId by project name via `project.all`
3. Create DNS A-record in CloudFlare (**with `--no-proxy`** for Let's Encrypt):
   ```bash
   bash scripts/cloudflare-dns.sh create <domain> <server-ip> --no-proxy
   ```
4. Wait 30s for DNS propagation
5. Add domain in Dokploy:
   ```bash
   bash scripts/dokploy-api.sh <server> POST domain.create '{
     "applicationId": "<id>",
     "host": "<domain>",
     "port": <port-or-3000>,
     "https": true,
     "path": "/",
     "certificateType": "letsencrypt"
   }'
   ```
6. Verify accessibility with `wait-ready.sh`
7. After SSL certificate is issued, optionally enable CloudFlare proxy

#### `domain remove <full-domain>`
Delete from Dokploy + CloudFlare.

#### `domain list [--server <name>]`
Show all domains across projects.

---

### `/vps db` — Database management

Supported types: `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

#### `db create <type> <name> [--project <project-name>]`

1. Find projectId and environmentId
2. Create via Dokploy API (all `*.create` calls require `environmentId`)
3. Deploy the database
4. Get and display connection strings (internal + external)

#### `db list [--server <name>]`
Show all databases on server.

#### `db delete <name>`
Delete database (after confirmation).

---

### `/vps status` — Server and project status

1. Get all projects via `project.all`
2. Get server resources via SSH (CPU, RAM, Disk)
3. Display formatted table

---

### `/vps logs` — View logs

**Syntax:** `logs <project-name> [--lines <n>] [--build]`

- **Runtime logs** (default): `docker service logs <service> --tail <n>`
- **Build logs** (`--build`): Get latest deploymentId, fetch build logs via API

---

### `/vps destroy` — Delete project

**Syntax:** `destroy <project-name> [--keep-db] [--keep-dns]`

**Always** ask for confirmation before deleting.

1. Find project and all related resources
2. Show what will be deleted
3. Wait for user confirmation
4. Stop app → delete app → delete DB (unless `--keep-db`) → delete DNS (unless `--keep-dns`) → delete project
5. Show deletion report

---

## Complex commands (use reference guides)

### `/vps setup` — Set up VPS from scratch

Read and follow: `references/setup-guide.md`

### `/vps deploy` — Deploy project from GitHub

Read and follow: `references/deploy-guide.md` + `references/stack-detection.md`

Key improvements in v3:
- After deploy, **do not suggest webhook setup** — GitHub App handles auto-deploy
- The deploy report should mention: "Auto-deploy is active via GitHub App. Push to `<branch>` to trigger redeploy."
- If user asks to redeploy, use `application.redeploy` API endpoint

---

## Help (when $ARGUMENTS is empty)

```
VPS Ninja v3 — VPS automation with Dokploy

Commands:

  /vps setup <ip> <password>              Set up a fresh VPS (install Dokploy)
  /vps deploy <github-url> [--domain D]   Deploy a GitHub project
  /vps domain add <domain> <project>      Add domain to project
  /vps domain remove <domain>             Remove domain
  /vps domain list                        List all domains
  /vps db create <type> <name>            Create DB (postgres/mysql/mongo/redis)
  /vps db list                            List all databases
  /vps db delete <name>                   Delete database
  /vps status [--server <name>]           Server and project status
  /vps logs <project> [--build]           Application or build logs
  /vps destroy <project>                  Delete project
  /vps config                             Show configuration
  /vps config server add <name> <ip>      Add server
  /vps config cloudflare <token>          Configure CloudFlare API

Examples:

  /vps setup 45.55.67.89 MyPassword123
  /vps deploy github.com/user/my-app --domain app.example.com
  /vps status
  /vps logs my-app --build
```

---

## Debug mode

If the user passes `--debug`, output verbose logs for all commands (curl outputs, JSON responses, etc.).
