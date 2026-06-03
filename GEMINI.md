---
name: dokpilot
description: >
  Deploy and manage applications on VPS servers with Dokploy.
  Use when the user wants to: set up a new VPS server, deploy a project
  from GitHub, manage domains/DNS, create databases, check server status,
  view logs, or remove deployed projects. Also use when the user mentions
  re-deploying, checking deploy status, adding environment variables, or
  troubleshooting a deployed app. Also triggers when users say things like
  "put this on my server", "I need hosting", "make this accessible online",
  "my site is down", "set up CI/CD for deployment", or anything related to
  getting code running on a remote server. Triggers on: VPS, deploy, server
  setup, Dokploy, hosting, domain, DNS, redeploy, server status, deploy logs,
  "put online", "host this", "site down", CI/CD.
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

# Dokpilot v3.1 — DevOps Automation Skill

You are a DevOps engineer. Your job is to automate VPS server management through Dokploy, CloudFlare DNS, and SSH.

## How this skill is organized

This skill lives in the directory containing this SKILL.md file. Determine the base path from the path you used to read this file:

- `<skill-dir>/scripts/` — Shell wrappers for Dokploy API, CloudFlare DNS, SSH
- `<skill-dir>/references/` — Detailed guides (read on demand, not upfront)
- `<skill-dir>/config/servers.json` — Server credentials (never expose to user)
- `<skill-dir>/templates/` — Server setup scripts

## Critical knowledge: GitHub App integration

Dokploy has a built-in GitHub App integration. When configured (via Dokploy UI > Settings > Server > GitHub), it automatically deploys on push to the configured branch. **No webhooks, no manual refresh tokens, no GitHub Actions needed.**

### Setting repository source (CRITICAL)

When configuring an application's GitHub repository, first check if the GitHub App is installed:

```bash
# Step 1: Get GitHub provider ID
PROVIDERS=$(bash scripts/dokploy-api.sh "$SERVER" GET "gitProvider.getAll")
GITHUB_ID=$(echo "$PROVIDERS" | jq -r '[.[] | select(.providerType == "github")][0].githubId // empty')
```

**If GitHub App is installed** (GITHUB_ID is non-empty) — use `saveGithubProvider`:
```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.saveGithubProvider '{
  "applicationId": "'"$APP_ID"'",
  "owner": "'"$OWNER"'",
  "repository": "'"$REPO"'",
  "branch": "main",
  "buildPath": "/",
  "githubId": "'"$GITHUB_ID"'",
  "triggerType": "push",
  "enableSubmodules": false
}'
```

**If GitHub App is NOT installed** — fall back to `customGitUrl`:
```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.update '{
  "applicationId": "'"$APP_ID"'",
  "sourceType": "git",
  "customGitUrl": "https://github.com/'"$OWNER"'/'"$REPO"'.git",
  "customGitBranch": "main"
}'
```

**DO NOT** use `sourceType: "github"` without first calling `saveGithubProvider` — it triggers "Github Provider not found" on deploy.

> **tRPC note:** All Dokploy mutations use HTTP POST. There are NO PUT or DELETE HTTP methods.

Parse owner/repo from GitHub URL:
```bash
OWNER=$(echo "$GITHUB_URL" | sed -E 's|.*github\.com/([^/]+)/.*|\1|')
REPO=$(echo "$GITHUB_URL" | sed -E 's|.*github\.com/[^/]+/([^/.]+).*|\1|')
```

### Auto-deploy behavior

- After initial deploy via this skill, subsequent pushes to `main` trigger auto-deploy automatically
- You do NOT need to set up webhooks or refresh tokens
- You do NOT need to configure GitHub Actions for deployment
- The `autoDeploy` flag in the API just enables/disables this behavior
- If the user asks to "redeploy", use `application.redeploy` API — don't suggest webhook setup

**If the user asks about auto-deploy**: Explain that it's already handled by the GitHub App installed in Dokploy. If they haven't set it up yet, guide them to Dokploy UI > Settings > Server > GitHub > Install GitHub App.

### Deployment strategy decision tree

Before deploying, determine which path to follow:

1. **Is the GitHub App installed?** (`GET gitProvider.getAll` has `providerType: "github"`)
   - YES → Use `application.saveGithubProvider` (works for public AND private repos)
   - NO → Continue to step 2

2. **Is the repo accessible from the server?** (SSH to server + `git ls-remote`)
   - YES → Use `application.update` with `sourceType: "git"` + `customGitUrl`
   - NO → Continue to step 3

3. **Does the user have a GitHub PAT?**
   - YES → Use `customGitUrl` with PAT: `https://<PAT>@github.com/owner/repo.git`
   - NO → Continue to step 4

4. **Fallback: Manual Docker build + Compose raw**
   - Clone locally → build Docker image on server → compose raw YAML
   - See `references/manual-docker-deploy.md`

## Getting documentation

This skill includes comprehensive Dokploy API reference and guides in `references/`. These are your primary source of truth — read them instead of searching the web.

**Documentation hierarchy (use in this order):**
1. `references/dokploy-api-reference.md` — Full API endpoint reference
2. `references/deploy-guide.md` — Step-by-step deploy workflow
3. `references/setup-guide.md` — VPS setup from scratch
4. `references/stack-detection.md` — How to detect project stack/framework
5. `references/github-app-autodeploy.md` — GitHub App setup and auto-deploy
6. `references/troubleshooting.md` — SSL, DNS, build errors, common issues
7. `references/manual-docker-deploy.md` — Fallback deploy without GitHub integration

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
| `ui` | Launch local web dashboard (see `ui` section) |
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
- Suggest: `/dokpilot config server add <name> <ip>` or `/dokpilot config cloudflare <token>`

### 2. Scripts

All scripts are in `<skill-dir>/scripts/`. Always use full paths when calling them.

| Script | Usage |
|:-------|:------|
| `dokploy-api.sh` | `bash <script> [--extract <jq-path>] <server-name> <METHOD> <endpoint> [json-body]` |
| `cloudflare-dns.sh` | `bash <script> <action> [args...]` (supports `--no-proxy` for DNS-only) |
| `ssh-exec.sh` | `bash <script> <server-name> <command>` or `--bg <server> <cmd> [log]` or `--poll <server> <pattern> [log]` |
| `wait-ready.sh` | `bash <script> <url> [timeout] [interval]` |

### 3. Security

- **Never output** API keys, passwords, tokens in responses to the user
- Before `destroy` **always** ask for confirmation
- Before creating/changing DNS records, show what will change
- Mask sensitive data in error logs
- **On macOS, store tokens in Keychain by default** (Dokploy API key, CloudFlare API token). `servers.json` holds references, not values. See `references/secrets-management.md`.

### 4. Error handling

- On API/SSH errors, explain clearly and suggest a fix
- Don't silently retry the same command — if it failed, something needs to change
- Use retry only for transient network errors

### 5. Determining skill path

```bash
SKILL_DIR="${DOKPILOT_SKILL_DIR:-$HOME/.claude/skills/dokpilot}"
```

Or determine from the path to this SKILL.md file.

---

## Inline commands

### `/dokpilot config` — Configuration management

Secrets (Dokploy API keys, CloudFlare token) are stored in the macOS Keychain when
available. `servers.json` holds a reference of the form `{"_secret": "<account>"}`;
the actual value is resolved via `scripts/secret-store.sh`. On non-macOS platforms,
or when the user declines, secrets stay as plain strings in `servers.json` (fully
backwards compatible).

#### `config` (no args)

Print a source report — **values are never printed**. For each secret field, show
whether it lives in the Keychain or as a plain value in the file:

```
servers.main.dokploy_api_key  → keychain (dokpilot / main:dokploy_api_key)
servers.main.ssh_key          → file (path)
cloudflare.api_token          → keychain (dokpilot / cloudflare:api_token)
defaults.server               → main
```

Non-secret fields (`host`, `ssh_user`, `dokploy_url`, `defaults`) may be shown as-is.

#### `config server add <name> <ip> [--ssh-key <path>]`

> Validate IP format before saving: `[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]`

1. Save public fields (`host`, `ssh_user`, `ssh_key`, `dokploy_url`, `added_at`) to `servers.json`:
   ```json
   {
     "host": "<ip>",
     "ssh_user": "root",
     "ssh_key": "<path-or-empty>",
     "dokploy_url": "http://<ip>:3000",
     "added_at": "<ISO-date>"
   }
   ```
2. Prompt for the Dokploy API key with hidden input:
   ```bash
   read -r -s -p "Dokploy API key for <name> (input hidden, empty to skip): " KEY
   ```
3. If the key is non-empty, ask **where to store** it:
   - If `bash scripts/secret-store.sh available` returns 0 (macOS + `security`), the default is **Keychain** (press Enter), with `p` to fall back to plain file.
   - On non-macOS, skip the question and save plain.
4. On Keychain choice:
   ```bash
   bash scripts/secret-store.sh set "<name>:dokploy_api_key" "<token>"
   ```
   and write `"dokploy_api_key": {"_secret": "<name>:dokploy_api_key"}` into `servers.json`.
5. On plain choice, write `"dokploy_api_key": "<token>"` directly.

> Never pass the key as a command argument — it would leak to shell history.

#### `config server remove <name>`

1. Ask for explicit `Y/n` confirmation.
2. Remove the server block from `servers.json`.
3. Delete related Keychain items: enumerate accounts `<name>:*` (from the references
   inside the removed block) and call `secret-store.sh delete` for each.

#### `config cloudflare [<api-token>]`

- **No argument (preferred):** prompt via `read -s`, then ask where to store (same flow as above). Default: Keychain on macOS.
- **Argument form:** save immediately — prefer Keychain on macOS — and print a warning: "token may have landed in shell history; consider rotating it or using the no-argument form next time."

Stored account: `cloudflare:api_token`.

#### `config default <server-name>`

Set default server.

#### `config migrate-to-keychain`

Move all existing plain-string secrets from `servers.json` into the Keychain.

1. Write a backup alongside: `config/servers.json.pre-keychain-<ISO-date>`.
2. For each known secret field whose value is a plain string
   (`servers.<name>.dokploy_api_key`, `cloudflare.api_token`):
   - Call `secret-store.sh set <name>:<field> "<value>"` (or `cloudflare:<field>`).
   - Replace the field in `servers.json` with `{"_secret": "<account>"}`.
3. Skip fields that are already `{"_secret": ...}` references.
4. Print a report: which fields were migrated, which were skipped, and where the
   backup lives. Do not print the values themselves.
5. On non-macOS, abort with a message pointing to `references/secrets-management.md`.

---

### `/dokpilot domain` — Domain management

#### `domain add <full-domain> <project-name> [--port <port>] [--server <name>]`

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

### `/dokpilot db` — Database management

Supported types: `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

#### `db create <type> <name> [--project <project-name>] [--server <name>]`

1. Find projectId and environmentId
2. Create via Dokploy API (all `*.create` calls require `environmentId`)
3. Deploy the database
4. Get and display connection strings (internal + external)

#### `db list [--server <name>]`
Show all databases on server.

#### `db delete <name>`
Delete database (after confirmation).

---

### `/dokpilot status` — Server and project status

**Syntax:** `status [--server <name>]`

1. Get all projects via `project.all`
2. Get server resources via SSH (CPU, RAM, Disk)
3. Display formatted table
4. **Warn if:**
   - Disk usage > 80%: "Warning: Disk almost full. Run `docker system prune` to free space."
   - RAM usage > 90%: "Warning: Low memory. Consider upgrading or reducing replicas."
   - Docker images accumulating: show `docker system df` summary

---

### `/dokpilot logs` — View logs

**Syntax:** `logs <project-name> [--lines <n>] [--build]`

- **Runtime logs** (default): `docker service logs <service> --tail <n>`
- **Build logs** (`--build`): Get latest deploymentId, fetch build logs via API

---

### `/dokpilot destroy` — Delete project

**Syntax:** `destroy <project-name> [--keep-db] [--keep-dns] [--server <name>]`

**Always** ask for confirmation before deleting.

1. Find project and all related resources
2. Show what will be deleted
3. Wait for user confirmation
4. Stop app → delete app → delete DB (unless `--keep-db`) → delete DNS (unless `--keep-dns`) → delete project
5. Show deletion report

---

## Complex commands (use reference guides)

### `/dokpilot setup` — Set up VPS from scratch

Read and follow: `references/setup-guide.md`

### `/dokpilot deploy` — Deploy project from GitHub

Read and follow: `references/deploy-guide.md` + `references/stack-detection.md`

Key improvements in v3.1:
- After deploy, **do not suggest webhook setup** — GitHub App handles auto-deploy
- The deploy report should mention: "Auto-deploy is active via GitHub App. Push to `<branch>` to trigger redeploy."
- If user asks to redeploy, use `application.redeploy` API endpoint

**`/dokpilot deploy --job <id>`** — worker mode (v4.0+).

When invoked with `--job`, you are a backgrounded deploy worker driven by the dashboard's job queue. The job spec is at `$JOB_PATH` (env var). Use the helpers under `$HELPERS_DIR` (also env):

- `update-status.sh <state>` — lifecycle transitions
- `log.sh <kind> "<message>"` — append a log line
- `ask-user.sh <id> "<label>" <type> "<extra>" "<hint>"` — blocking question
- `set-result.sh key=value ...` — final result

The full worker prompt + helper protocol is in `mcp-server/ui-server/lib/claude-worker.js`. The dashboard's `POST /api/jobs/deploy` already spawns this flow automatically — manual `/dokpilot deploy --job <id>` is only for restarting or debugging a stuck job.

### `/dokpilot ui` — Launch local web dashboard

Launches the Dokpilot UI server (`mcp-server/ui-server/server.js`) on a random ephemeral 127.0.0.1 port with a per-session bearer token, then opens the dashboard in the default browser.

**Run:**

```bash
bash "$REPO/mcp-server/ui-server/launch.sh"
```

(where `$REPO` is the repo root — resolve via the install-path rules in **5. Determining skill path**, then walk one level up since the skill lives at `<repo>/skills/dokpilot/`.)

**Subcommands:**

| Form | Effect |
|:-----|:-------|
| `/dokpilot ui` | Start (or print URL if already running) and `open` the dashboard. |
| `/dokpilot ui --stop` | Kill the running server (if any). |
| `/dokpilot ui --status` | Print pid / port / URL if alive. |
| `/dokpilot ui --no-open` | Start but don't `open` the URL (CI use). |

**State files** (under `~/.claude/skills/dokpilot/`, mode 0600):

- `.ui-pid` — pid of the running ui-server
- `.ui-port` — the ephemeral port picked at launch
- `.ui-url` — full URL including the bearer token
- `ui-server.log` — server stderr

**What it serves:** the static `dokpilot-ui/` (sibling to `mcp-server/`) — multi-page web dashboard for projects / servers / domains / databases / deploys / logs / Claude console. Currently shipped milestone is **M0** (foundation): static serve + auth + `/api/health` only. Real API endpoints (`/api/servers`, `/api/apps`, deploy job-runner, log SSE streams) land in subsequent milestones — the UI is on MOCK_DATA until each milestone wires the backend.

**Security:** 127.0.0.1 bind only, random port per launch, 32-byte bearer token rotated each start, strict Origin/Referer check, HttpOnly SameSite=Strict cookie after first GET. The dashboard refuses direct visits without a launch-issued token. **Never expose remotely** (no tunnels, no port-forwards).

---

## Help (when $ARGUMENTS is empty)

```
Dokpilot v3.1 — VPS automation with Dokploy

Commands:

  /dokpilot setup <ip> <password>              Set up a fresh VPS (install Dokploy)
  /dokpilot deploy <github-url> [--domain D]   Deploy a GitHub project
  /dokpilot domain add <domain> <project>      Add domain to project [--server S]
  /dokpilot domain remove <domain>             Remove domain
  /dokpilot domain list                        List all domains
  /dokpilot db create <type> <name>            Create DB [--server S] [--project P]
  /dokpilot db list                            List all databases
  /dokpilot db delete <name>                   Delete database
  /dokpilot status [--server <name>]           Server and project status
  /dokpilot logs <project> [--build]           Application or build logs
  /dokpilot destroy <project>                  Delete project [--server S]
  /dokpilot config                             Show configuration
  /dokpilot config server add <name> <ip>      Add server
  /dokpilot config cloudflare <token>          Configure CloudFlare API
  /dokpilot ui                                 Open local web dashboard
  /dokpilot ui --stop                          Stop the dashboard server

Examples:

  /dokpilot setup 45.55.67.89 MyPassword123
  /dokpilot deploy github.com/user/my-app --domain app.example.com
  /dokpilot status
  /dokpilot logs my-app --build
```

---

## Debug mode

If the user passes `--debug`, output verbose logs for all commands (curl outputs, JSON responses, etc.).
