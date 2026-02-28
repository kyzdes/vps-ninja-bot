# VPS Ninja — Claude Code Skill for VPS Deployment

> Deploy and manage apps on your VPS through [Dokploy](https://dokploy.com) — right from Claude Code.

One command to go from a fresh VPS to a fully deployed app with SSL, domain, and auto-deploy on push.

```
/vps deploy github.com/user/my-app --domain app.example.com
```

## What It Does

VPS Ninja is a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that turns Claude into a DevOps engineer for your VPS. It handles the full lifecycle:

- **Setup** — install Dokploy on a fresh VPS, configure firewall, get API keys
- **Deploy** — detect your stack, create project, set up env vars, deploy, configure SSL
- **Domains** — create DNS records in CloudFlare, attach to projects, manage SSL
- **Databases** — create PostgreSQL, MySQL, MongoDB, Redis with one command
- **Monitor** — check server status, view build and runtime logs
- **Auto-deploy** — push to GitHub and your app updates automatically (via GitHub App)

## Quick Start

### 1. Install the skill

```bash
# Clone and symlink (auto-updates on git pull)
git clone https://github.com/kyzdes/vps-ninja.git ~/vps-ninja
ln -s ~/vps-ninja ~/.claude/skills/vps
```

Or copy directly:
```bash
git clone https://github.com/kyzdes/vps-ninja.git /tmp/vps-ninja
mkdir -p ~/.claude/skills
cp -r /tmp/vps-ninja ~/.claude/skills/vps
```

### 2. Install dependencies

```bash
# macOS
brew install jq sshpass

# Ubuntu/Debian
sudo apt install jq sshpass
```

### 3. Set up your VPS

```
/vps setup <your-server-ip> <root-password>
```

Claude will SSH in, install Dokploy, set up the firewall, and walk you through creating an admin account.

### 4. Deploy your first app

```
/vps deploy github.com/your-user/your-app --domain app.yourdomain.com
```

Claude will detect your stack (Next.js, Django, Go, etc.), create the project in Dokploy, set up DNS in CloudFlare, deploy, and configure SSL. After that, every push to `main` triggers an auto-deploy — no webhooks or CI/CD needed.

## Commands

| Command | What it does |
|:--------|:------------|
| `/vps setup <ip> <password>` | Set up a fresh VPS with Dokploy |
| `/vps deploy <github-url> [--domain D]` | Deploy a GitHub project |
| `/vps domain add <domain> <project>` | Add domain to a project |
| `/vps domain remove <domain>` | Remove domain |
| `/vps domain list` | List all domains |
| `/vps db create <type> <name>` | Create database (postgres/mysql/mongo/redis) |
| `/vps db list` | List all databases |
| `/vps db delete <name>` | Delete database |
| `/vps status` | Server and project status |
| `/vps logs <project> [--build]` | View runtime or build logs |
| `/vps destroy <project>` | Delete a project |
| `/vps config` | Show current configuration |

## Supported Stacks

The skill auto-detects your project's stack and configures everything accordingly:

**Node.js** — Next.js, Nuxt, NestJS, Express, Remix, Vite, Astro
**Python** — Django, FastAPI, Flask
**Go** — any Go project
**Rust** — any Rust project
**Ruby** — Rails, Sinatra
**Java** — Spring Boot, Maven, Gradle
**.NET** — ASP.NET Core
**PHP** — Laravel, Symfony
**Docker** — Dockerfile or docker-compose.yml

## (Optional) MCP Server for Dokploy Docs

VPS Ninja includes a bundled MCP server that gives Claude always-fresh Dokploy documentation. To enable:

```bash
cd ~/.claude/skills/vps/mcp-server && npm install
```

Add to `~/.claude/.mcp.json`:
```json
{
  "mcpServers": {
    "dokploy-docs": {
      "command": "node",
      "args": ["<full-path-to>/mcp-server/index.js"]
    }
  }
}
```

The MCP server provides three tools: `dokploy_api_reference`, `dokploy_guide`, and `dokploy_search`.

## Architecture

```
├── SKILL.md                        # Main skill logic and command routing
├── references/
│   ├── deploy-guide.md             # Step-by-step deploy workflow (3 phases)
│   ├── setup-guide.md              # VPS setup from scratch
│   ├── stack-detection.md          # Framework detection rules
│   ├── dokploy-api-reference.md    # Full Dokploy API reference (v0.27+)
│   ├── github-app-autodeploy.md    # GitHub App auto-deploy guide
│   └── troubleshooting.md          # SSL, DNS, build errors
├── scripts/
│   ├── dokploy-api.sh              # Dokploy REST API wrapper
│   ├── cloudflare-dns.sh           # CloudFlare DNS wrapper
│   ├── ssh-exec.sh                 # SSH command wrapper
│   └── wait-ready.sh               # URL health check
├── templates/
│   └── setup-server.sh             # VPS setup script
├── config/
│   ├── servers.json                # Your credentials (gitignored)
│   └── servers.json.example        # Config template
└── mcp-server/                     # Optional Dokploy Docs MCP server
    ├── index.js
    ├── docs/
    └── scripts/fetch-docs.js
```

## How It's Different from Using Claude Without a Skill

We ran a benchmark of 3 real-world scenarios — with and without the skill — on Claude Opus 4.6:

| Metric | With Skill | Without Skill | Delta |
|:-------|:-----------|:--------------|:------|
| **Pass rate** | 100% | 25% | **+75%** |
| **Avg time** | 137.7s | 180.0s | **-42.3s** |

Without the skill, Claude searches the web for Dokploy docs (slow, often outdated), recommends setting up GitHub webhooks for auto-deploy (wrong — Dokploy uses a GitHub App), and misses critical details like `--no-proxy` DNS records for Let's Encrypt.

With the skill, Claude reads built-in reference guides, knows that auto-deploy works via GitHub App without webhooks, and follows the exact right sequence every time.

Full benchmark results: [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md) | [Interactive viewer](benchmarks/eval-viewer.html) (download and open in browser)

## Version History

### v3 (current)

Major rewrite focused on accuracy and speed.

- **Built-in Dokploy docs** — 6 reference guides eliminate web searching entirely
- **GitHub App auto-deploy knowledge** — skill understands that Dokploy auto-deploys via GitHub App, never suggests webhooks
- **MCP server** — optional Dokploy documentation server for edge cases
- **Troubleshooting guide** — built-in fixes for SSL, DNS, and build errors
- **Updated for Dokploy v0.27+** — correct `environmentId` handling in API calls
- **DNS `--no-proxy`** — creates CloudFlare records in DNS-only mode for Let's Encrypt
- **Benchmarked** — 100% pass rate across all test scenarios

### v2

Incremental update for Dokploy v0.27 compatibility.

- Updated API calls for new `environmentId` requirement
- Improved security hardening scripts
- Better error messages

### v1

Initial release.

- Basic deploy, setup, domain, database commands
- 4 reference guides (deploy, setup, stack detection, API reference)
- CloudFlare DNS and SSH wrappers

## Security

- `config/servers.json` is **never committed** to git (gitignored)
- API keys and passwords are **never shown** in Claude's responses
- Destructive operations (`destroy`, `db delete`) always require confirmation

## License

MIT

## Contributing

PRs welcome. If you find a bug or want to add support for a new stack, open an issue or submit a PR.
