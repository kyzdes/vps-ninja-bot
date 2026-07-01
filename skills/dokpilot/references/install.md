# Install & Onboarding

The authoritative, step-by-step walkthrough for getting Dokpilot running and
doing your first deploy. If you just want the short version, see the
[README Install section](../../../README.md#install).

Dokpilot is a **local, single-user** tool: it runs on your machine, uses your
credentials, and deploys to **your** VPS. There is no hosted service. Before
you start, skim [SECURITY.md](../../../SECURITY.md) — especially
"What this can do to your machine, servers, and bill."

---

## Prerequisites

| Requirement | Why | Install |
|:------------|:----|:--------|
| **Node.js 20+** | Runs the local dashboard (`mcp-server/ui-server/`, stdlib-only) | <https://nodejs.org> or `brew install node` |
| **jq** | JSON parsing in the shell scripts | `brew install jq` / `apt install jq` |
| **sshpass** | Non-interactive SSH during `setup` | `brew install sshpass` / `apt install sshpass` |
| **git** | Cloning the skill + target repos | usually preinstalled |
| A **VPS** | The deploy target (Dokploy runs here) | any Ubuntu/Debian box, 2 GB RAM / 30 GB disk min |
| (optional) **Cloudflare** | DNS + SSL automation | a token scoped to your zone(s) |

**Platform support:**

- **macOS** — full support. Dokploy API keys and the Cloudflare token are
  stored in the system **Keychain**; `servers.json` holds only `{_secret}`
  references. This is the recommended host for anything sensitive.
- **Linux / non-macOS** — supported, but there is **no OS keystore**, so
  secrets are stored as **plaintext** in `servers.json` (mode `0600`) and
  Dokpilot warns loudly when it does so. Keep that file private and never
  commit it.

---

## Step 1 — Install the skill (Mode B: clone + symlink)

Mode B is the primary install path today.

```bash
# 1. Clone the repo
git clone https://github.com/kyzdes/dokpilot.git ~/dokpilot

# 2. Symlink the skill into Claude's skills dir.
#    NOTE: the skill lives in the skills/dokpilot subfolder of the repo.
mkdir -p ~/.claude/skills
ln -s ~/dokpilot/skills/dokpilot ~/.claude/skills/dokpilot
```

Confirm Claude can see it: start Claude Code and the `dokpilot` skill should be
available (the frontmatter `name:` is `dokpilot`). The skill locates its own
scripts/references via self-location, so the symlink target is what matters.

> **Mode A (marketplace) — coming soon.** Once a `dokpilot` entry lands in the
> `kyzdes/claude-skills` marketplace, you'll be able to
> `/plugin marketplace add kyzdes/claude-skills` then
> `/plugin install dokpilot@claude-skills`. Until then, use Mode B.

Install the runtime deps if you haven't:

```bash
brew install jq sshpass         # macOS
sudo apt install -y jq sshpass  # Ubuntu/Debian
```

---

## Step 2 — Set up a VPS (adds your first server)

If your VPS doesn't have Dokploy yet, let Dokpilot install it:

```
/dokpilot setup <server-ip> <root-password>
```

This SSHes in, checks resources, updates the system, configures UFW (ports 22,
80, 443, 3000), installs Dokploy, and waits for it to come up. Dokploy mints its
own API key in its **first-run web UI** — Dokpilot cannot do that headlessly, so
it will ask you to:

1. Open `http://<server-ip>:3000` in a browser.
2. Create the admin account.
3. Go to **Settings → Profile → API/CLI → Generate API Key**.
4. Paste the key back to Dokpilot.

If Dokploy is **already installed**, just add the server:

```
/dokpilot config server add main <server-ip>
# prompts (hidden) for the Dokploy API key
```

---

## Step 3 — Secret storage (Keychain vs plaintext)

When you add a server or Cloudflare token, Dokpilot stores the secret according
to your platform:

- **macOS:** the value goes into the Keychain (service `dokpilot`, account like
  `main:dokploy_api_key`). `servers.json` records only
  `{"_secret": "main:dokploy_api_key"}`. On first read, macOS shows a Keychain
  permission dialog — pick **Always Allow** to whitelist the calling binary.
- **Linux:** the value is written as a plaintext string in `servers.json`
  (mode `0600`), with a loud warning.

You can verify/manage secrets directly:

```bash
# is a Keychain available here? (exit 0 = macOS Keychain, exit 1 = plaintext fallback)
bash scripts/secret-store.sh available

# store / read / delete (macOS)
bash scripts/secret-store.sh set    "main:dokploy_api_key"   # reads value from STDIN
bash scripts/secret-store.sh get    "main:dokploy_api_key"
bash scripts/secret-store.sh delete "main:dokploy_api_key"
```

The resulting `servers.json` (macOS) looks like:

```json
{
  "servers": {
    "main": {
      "host": "203.0.113.10",
      "ssh_user": "root",
      "ssh_key": "~/.ssh/id_ed25519",
      "dokploy_url": "http://203.0.113.10:3000",
      "dokploy_api_key": { "_secret": "main:dokploy_api_key" }
    }
  },
  "cloudflare": { "api_token": { "_secret": "cloudflare:api_token" } },
  "defaults": { "server": "main" }
}
```

See [`secrets-management.md`](secrets-management.md) for rotation, migration,
and troubleshooting.

### (optional) Cloudflare

```
/dokpilot config cloudflare <api-token>
```

Scope the token narrowly: **Zone → DNS → Edit** on only the zone(s) you deploy
to. Dokpilot uses it to create `--no-proxy` A-records so Let's Encrypt can issue
certificates.

---

## Step 4 — First deploy

```
/dokpilot deploy github.com/user/app --domain app.example.com
```

What happens (the realized two-phase flow):

1. **Analyze (Phase A, read-only).** Dokpilot shallow-clones the repo into a
   throwaway dir and a headless agent inspects it with Read/Grep/Glob only,
   emitting a validated stack manifest (runtime, framework, env-var *names*,
   build/start commands). It cannot run commands or write to the repo.
2. **Confirm.** Dokpilot shows you the plan. Any freeform/flagged command is
   surfaced here. Nothing destructive or infra-changing runs until you confirm.
3. **Actuate (Phase B, infra only).** A second agent creates the Dokploy
   project, sets env vars, wires auto-deploy via the GitHub App, creates the
   Cloudflare DNS record, adds the domain with SSL, deploys, and verifies HTTPS.
   It works from the manifest only and never re-reads the repo.

You'll be asked (hidden) for any secret env vars the app needs (e.g.
`NEXTAUTH_SECRET`). Result: `https://app.example.com` is live with auto-deploy
on push.

> Each `analyze`/`deploy` runs a headless `claude` and **consumes your own
> Claude usage**.

---

## Step 5 — The local dashboard (optional)

```
/dokpilot ui            # launch (opens the browser)
/dokpilot ui --status   # is it running?
/dokpilot ui --stop     # stop it
```

The dashboard binds `127.0.0.1` with a per-launch bearer token and is for
inventory, deploy wizard, live logs, domains, and databases. On headless Linux
the launcher prints the URL instead of opening a browser; set
`DOKPILOT_STATE_DIR` to relocate its pid/port/url files.

---

## Verifying the install (clean machine)

To prove the Mode B path on a throwaway HOME without touching real credentials:

```bash
bash scripts/clean-machine-smoke.sh
```

It checks prerequisites, skill self-location, the secret-store branch for your
platform, a safe `servers.json` write (`0600`, refs-only on macOS), and that the
dashboard boots and answers `/api/health`. It proves **Mode B only**; Mode A
depends on the marketplace entry landing.

---

## Troubleshooting

| Symptom | Fix |
|:--------|:----|
| `node not on PATH` when launching the UI | Install Node 20+ |
| `sshpass not found` during setup | `brew install sshpass` / `apt install sshpass` |
| Keychain dialog keeps reappearing | Click **Always Allow** once; see `secrets-management.md` |
| Dokploy API key rejected (401/403) | Regenerate in Dokploy → Settings → API/CLI |
| Let's Encrypt fails | Ensure the DNS record is `--no-proxy` (Dokpilot does this by default) |

More: [`troubleshooting.md`](troubleshooting.md), [`setup-guide.md`](setup-guide.md),
[`deploy-guide.md`](deploy-guide.md).
