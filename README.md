# dokpilot

<p align="center">
  <img src="https://raw.githubusercontent.com/kyzdes/dokpilot-landing/main/public/brand/banner.png" alt="Dokpilot — Deploy anything. One command. No DevOps." width="100%" />
</p>

> Deploy and manage applications on VPS servers with Dokploy (Claude Code / Codex / Gemini skill).

## Install

Dokpilot is a **local, single-user** skill — it runs on your machine, uses your
credentials, and deploys to **your** VPS. There is no hosted service.

### Prerequisites

- **Node.js 20+** (runs the local dashboard, standard-library only)
- **jq** and **sshpass** — `brew install jq sshpass` (macOS) / `sudo apt install -y jq sshpass` (Ubuntu/Debian)
- **git**, and a **VPS** you control (2 GB RAM / 30 GB disk minimum)
- Optional: a **Cloudflare** token for DNS + SSL

**Platform support:** on **macOS**, Dokploy/Cloudflare secrets live in the system
**Keychain** and `servers.json` holds only `{_secret}` references. On
**Linux / non-macOS** there is no OS keystore, so secrets are stored as
**plaintext** in `servers.json` (mode `0600`) with a loud warning — keep that
file private and never commit it.

### Mode B — clone + symlink (primary)

```bash
git clone https://github.com/kyzdes/dokpilot.git ~/dokpilot
mkdir -p ~/.claude/skills
# the skill lives in the skills/dokpilot subfolder of the repo:
ln -s ~/dokpilot/skills/dokpilot ~/.claude/skills/dokpilot
```

Launch the dashboard with `/dokpilot ui` (see [Dashboard](#dashboard-new-in-v40)).
The skill locates its own scripts and references via self-location, so the
symlink target is what matters.

### Mode A — marketplace (coming soon)

Once a `dokpilot` entry lands in the `kyzdes/claude-skills` marketplace:

```
/plugin marketplace add kyzdes/claude-skills
/plugin install dokpilot@claude-skills
```

Until then, use **Mode B**.

Full walkthrough (add server → secret store → first deploy):
[`skills/dokpilot/references/install.md`](skills/dokpilot/references/install.md).

---

<p align="center">
  <img src="https://img.shields.io/badge/version-v4.4.0-00FF41?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/pass_rate-100%25-00FF41?style=flat-square" alt="Pass Rate" />
  <img src="https://img.shields.io/badge/stacks-20+-blue?style=flat-square" alt="Stacks" />
  <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="License" />
</p>

# Dokpilot

> One command to go from a GitHub repo to a live app with SSL, domain, and auto-deploy on push.

```
/dokpilot deploy github.com/user/my-app --domain app.example.com
```

Dokpilot is a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that turns Claude into a DevOps engineer for your VPS. It automates the full lifecycle through [Dokploy](https://dokploy.com) and CloudFlare DNS — setup, deploy, domains, databases, monitoring, and teardown.

---

## Benchmarks

We tested Claude with and without Dokpilot across 3 real-world DevOps scenarios:

<table>
<tr>
<td width="50%">

### With Dokpilot
- Pass rate: **100%**
- Reads built-in references instantly
- Uses correct tRPC API calls
- DNS `--no-proxy` for Let's Encrypt
- Auto-deploy via GitHub App (no webhooks)

</td>
<td width="50%">

### Without Dokpilot
- Pass rate: **24%**
- Googles outdated Dokploy docs
- Misses required API fields
- Breaks SSL with CloudFlare proxy
- Recommends manual webhook setup

</td>
</tr>
</table>

> **Most revealing test:** When asked about auto-deploy, naked Claude recommends setting up webhooks — the exact opposite of how Dokploy works. Dokpilot correctly explains that the GitHub App handles it automatically.

Full results: [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md)

---

## Quick Start

Install the skill first (see [Install](#install)), then:

### 1. Set up your VPS

```
/dokpilot setup <server-ip> <root-password>
```

Claude SSHs in, installs Dokploy, configures the firewall, and walks you through
creating an admin account + generating a Dokploy API key.

### 2. Deploy

```
/dokpilot deploy github.com/user/app --domain app.example.com
```

Dokpilot **analyzes** the repo read-only, shows you a plan, and — after you
confirm — creates the project in Dokploy, sets up DNS + SSL, deploys, and
enables auto-deploy on push. See [How It Works](#how-it-works) for the
two-phase detail.

Full onboarding walkthrough:
[`skills/dokpilot/references/install.md`](skills/dokpilot/references/install.md).

---

## Commands

| Command | Description |
|:--------|:------------|
| `/dokpilot setup <ip> <password>` | Set up a fresh VPS with Dokploy |
| `/dokpilot deploy <url> [--domain D] [--dry-run]` | Deploy from GitHub |
| `/dokpilot domain add <domain> <project>` | Add domain with SSL |
| `/dokpilot domain remove <domain>` | Remove domain |
| `/dokpilot domain list` | List all domains |
| `/dokpilot db create <type> <name>` | Create database (postgres/mysql/mongo/redis) |
| `/dokpilot db list` | List databases |
| `/dokpilot db delete <name>` | Delete database |
| `/dokpilot status` | Server + project status with resource warnings |
| `/dokpilot logs <project> [--build]` | Runtime or build logs |
| `/dokpilot destroy <project>` | Delete project (with confirmation) |
| `/dokpilot config` | Manage servers and CloudFlare config |
| `/dokpilot ui` | Launch the local web dashboard (new in v4.0) |

All commands support `--server <name>` for multi-server setups.

---

## Dashboard (new in v4.0)

`/dokpilot ui` launches a local web dashboard at `http://127.0.0.1:<port>/`
(bearer-token gated, 127.0.0.1-only) with:

- **Servers + apps inventory** — live status from your configured Dokploy instances
- **Deploy wizard** — paste a GitHub URL, answer the questions Claude asks, watch
  the build stream live, click the resulting URL
- **Live log tail** — SSE-streamed deploy logs via SSH `tail -f`
- **Domains + DNS** — Dokploy domains × Cloudflare records, with one-click add
- **Databases** — list, create (postgres / mysql / mariadb / mongo / redis)
- **Claude console** — chat with Claude directly inside the dashboard; tool
  calls and reasoning stream inline

Backend is Node 20 stdlib only (zero npm deps), lives in
[`mcp-server/ui-server/`](mcp-server/ui-server/). Start with `/dokpilot ui`,
stop with `/dokpilot ui --stop`, status with `--status`.

---

## Supported Stacks

Auto-detected from your project files:

| Runtime | Frameworks |
|:--------|:-----------|
| **Node.js** | Next.js, Nuxt, NestJS, Express, Remix, Vite, Astro |
| **Python** | Django, FastAPI, Flask |
| **Go** | Any Go project |
| **Rust** | Any Rust project |
| **Ruby** | Rails, Sinatra |
| **Java** | Spring Boot, Maven, Gradle |
| **.NET** | ASP.NET Core |
| **PHP** | Laravel, Symfony |
| **Docker** | Dockerfile or docker-compose.yml |

---

## How It Works

Deploy runs in **two phases** with a human gate in between. The target repo is
treated as **untrusted input** (see [SECURITY.md](SECURITY.md)).

```
You: /dokpilot deploy github.com/user/app --domain app.example.com

── Phase A · ANALYZE (read-only) ───────────────────────────────
  Shallow-clones the repo into a throwaway dir. A headless agent
  inspects it with Read / Grep / Glob ONLY (no Bash, no Write, no
  bypassPermissions) and emits a schema-validated stack manifest
  (e.g. Next.js + Prisma + PostgreSQL, env-var NAMES, build/start).

── CONFIRM · plan-then-confirm gate ────────────────────────────
  Dokpilot shows the plan and asks for any secret env vars
  (NEXTAUTH_SECRET, etc.). Flagged/freeform commands are surfaced
  here. Nothing infra-changing runs until you confirm.

── Phase B · ACTUATE (infra only) ──────────────────────────────
  Driven ONLY by the validated manifest (never re-reads the repo):
    1. Creates project + PostgreSQL in Dokploy
    2. Connects repo via GitHub App (auto-deploy enabled)
    3. Sets build type (Nixpacks) with all required API fields
    4. Creates DNS A-record in Cloudflare (--no-proxy for SSL)
    5. Adds domain with Let's Encrypt certificate
    6. Deploys, monitors logs, verifies HTTPS

Result: https://app.example.com is live
        Auto-deploy active — push to main to redeploy
```

> This is a **containment** posture, not a sandbox: Phase A has no write/exec
> capability and the manifest is the only thing crossing into Phase B.

### Deployment fallback chain

If the GitHub App isn't available, the skill automatically falls back:

```
GitHub App (recommended)
  └─ Public git URL
       └─ PAT-authenticated URL
            └─ Manual Docker build on server
```

---

## Architecture

```
dokpilot/                          # this repo
├── skills/dokpilot/               # the skill itself (symlink target for Mode B)
│   ├── SKILL.md                   # skill logic + command routing
│   ├── scripts/                   # Bash core (D-002: shell, not Node)
│   │   ├── dokploy-api.sh         # Dokploy tRPC client; destroy env-gate
│   │   ├── cloudflare-dns.sh      # Cloudflare DNS (multi-part TLD support)
│   │   ├── ssh-exec.sh            # SSH wrapper (normal/bg/poll modes)
│   │   ├── secret-store.sh        # macOS Keychain wrapper
│   │   └── wait-ready.sh          # URL health checker
│   ├── references/                # built-in guides (primary source of truth)
│   │   ├── install.md             # onboarding walkthrough
│   │   ├── deploy-guide.md  setup-guide.md  stack-detection.md
│   │   ├── secrets-management.md  troubleshooting.md  …
│   ├── config/
│   │   └── servers.json           # credentials / {_secret} refs (gitignored)
│   └── templates/                 # VPS init script(s)
├── mcp-server/ui-server/          # local dashboard backend (Node 20 stdlib, zero-dep)
│   ├── server.js                  # 127.0.0.1 + bearer token + CSRF + Host allow-list
│   ├── launch.sh                  # cross-platform launcher (/dokpilot ui)
│   └── lib/
│       ├── analyze-worker.js      # Phase A — read-only repo analysis
│       ├── claude-worker.js       # Phase B — infra-only actuation (manifest-driven)
│       ├── manifest.js            # the trust-boundary validator
│       ├── worker-guard.js        # shared hard guard for the workers
│       └── destroy-nonce.js       # server-minted single-use HMAC for UI deletes
├── dokpilot-ui/                   # dashboard HTML/CSS/JS (static)
├── scripts/clean-machine-smoke.sh # throwaway-HOME install smoke (Mode B)
└── benchmarks/                    # eval results and viewer
```

The security-critical boundary is the **manifest**: Phase A (read-only) emits
it, `lib/manifest.js` validates it, and Phase B acts on *only* that. See
[SECURITY.md](SECURITY.md).

---

## Security

> ### ⚠️ What this can do to your machine, servers, and bill
>
> Dokpilot is a **real DevOps automation**, not a sandbox. Running as you, it can:
>
> - **Your machine:** run local shell, clone arbitrary third-party repos, and
>   read the secrets you stored for it.
> - **Your servers:** SSH in (often as `root`) and create, deploy, restart, and
>   **delete** Dokploy projects, apps, databases, and domains.
> - **Your DNS:** create/modify Cloudflare records for the zones your token covers.
> - **Your bill:** each deploy runs a headless `claude` and **spends your own
>   Claude usage**.
>
> **Only point it at repositories and servers you trust.** The full trust
> boundary, threat model (repo prompt injection), two-phase defense, safety
> controls, and honest residual risks are in **[SECURITY.md](SECURITY.md)**.

### Cost & Privacy

- **Cost:** every `analyze`/`deploy` consumes your Claude subscription/API
  usage. Server, bandwidth, and domain costs are billed by your VPS and
  registrar.
- **Your data stays yours:** the repo and its env vars go to **your** Dokploy
  instance over your credentials. Nothing is sent to a Dokpilot-controlled
  service.
- **Cloudflare token scope:** grant only **Zone → DNS → Edit** on the specific
  zone(s) you deploy to — nothing broader.
- **Local-only storage:** credentials live in your macOS **Keychain** (or a
  `0600` `servers.json` on Linux, with a loud warning). Secret values are never
  echoed.
- **No telemetry:** Dokpilot has no analytics, no phone-home, no accounts.

---

## Documentation

| Document | Description |
|:---------|:------------|
| [`SECURITY.md`](SECURITY.md) | Trust boundary, threat model, safety controls, residual risks |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute (issues-only support, hard constraints) |
| [`skills/dokpilot/references/install.md`](skills/dokpilot/references/install.md) | Full onboarding walkthrough |
| [`PRD.md`](PRD.md) | Product requirements, architecture, all commands |
| [`CHANGELOG.md`](CHANGELOG.md) | Full version history |
| [`fixed-errors.md`](fixed-errors.md) | Production bugs: root cause + solution |
| [`benchmarks/BENCHMARK.md`](benchmarks/BENCHMARK.md) | Benchmark methodology and results |

---

## Version History

**Current: v4.0.0** (2026-05-24) — [Full changelog](CHANGELOG.md)

- v4.0: Rebrand to Dokpilot, Dokploy v0.29+ baseline, local web dashboard with deploy wizard & SSE log streaming, real Claude console
- v3.2: macOS Keychain secret store (`scripts/secret-store.sh`)
- v3.1: Fixed GitHub App integration, 4-tier deploy fallback, command injection fix, `--dry-run` mode
- v3.0: Built-in reference guides, MCP server, benchmarks (100% pass rate)
- v2.0: Dokploy v0.27 compatibility (`environmentId`)
- v1.0: Initial release — 8 commands, 20+ stacks

---

## Support & Contributing

Solo-maintained, **issues-only** support — no SLA, no Discord, no roadmap
voting. Found a bug or want a new stack? [Open an issue](https://github.com/kyzdes/dokpilot/issues).

- Contributor guide + hard constraints (Bash core, zero-dep ui-server, never
  commit `servers.json`/`context-map-*/`): [CONTRIBUTING.md](CONTRIBUTING.md).
- Security issues: follow responsible disclosure in [SECURITY.md](SECURITY.md)
  — do not file them as normal public issues.

## License

[MIT](LICENSE) — provided **"AS IS", without warranty of any kind**. You run
Dokpilot against your own servers and repos at your own risk.
