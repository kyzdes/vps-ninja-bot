# Security

Dokpilot is a **local, single-user** developer tool. It deploys applications
to **your own** VPS through [Dokploy](https://dokploy.com) and Cloudflare DNS.
It is **not** a hosted service and it does **not** run any of your code or
credentials on infrastructure we control.

This document is the honest disclosure surface: what Dokpilot can do to your
machine, servers, and bill; the trust boundary it runs behind; the threat model
it defends against; and the residual risks it does **not** eliminate.

> **This is not a sandbox.** Dokpilot runs local shell, SSH, and Dokploy/DNS
> API calls on your behalf, and it ingests arbitrary third-party repositories.
> Read [What this can do](#what-this-can-do-to-your-machine-servers-and-bill)
> before pointing it at anything.

---

## 1. Scope and nature

- **Local skill/plugin.** Dokpilot is a Claude Code skill (also usable from
  Codex CLI / Gemini CLI). It executes on your workstation, as you, with your
  permissions. There is no Dokpilot server, account, or telemetry.
- **You supply the targets.** You bring the VPS (its Dokploy API key + SSH
  access) and, optionally, a Cloudflare token. Dokpilot orchestrates them.
- **No warranty.** Dokpilot is released under the [MIT License](LICENSE), which
  is provided **"AS IS", without warranty of any kind**. You operate it at your
  own risk against servers and repositories you control.

---

## 2. Trust boundary

Dokpilot has two surfaces that touch credentials and remote systems: the
**local dashboard** (`/dokpilot ui`) and the **skill CLI** (the Bash scripts
Claude runs directly). Both are designed to keep the attack surface tiny.

**Local dashboard (`mcp-server/ui-server/`):**

- **Binds `127.0.0.1` only.** The HTTP server never listens on a public
  interface.
- **Per-launch bearer token.** Each launch mints a fresh random token
  (`crypto.randomBytes`). Every request is checked with
  `crypto.timingSafeEqual`; requests without the token get `401`.
- **Host allow-list (anti-DNS-rebind).** Requests whose `Host` header is not
  `127.0.0.1`/`localhost` are rejected `403`, so a malicious page cannot rebind
  DNS to reach the loopback server.
- **Per-POST CSRF token** on every state-changing request.
- **`execFile` with argv arrays.** Shell helpers are invoked with explicit
  argument vectors (no string concatenation into a shell), preventing command
  injection through user/config input.

**Credentials:**

- **macOS: Keychain only.** Dokploy API keys and the Cloudflare token live in
  the system Keychain (service `dokpilot`). `servers.json` stores only
  `{"_secret": "<account>"}` references plus non-secret metadata (host, SSH
  user, SSH key *path*, URL), and is written `0600`. A Keychain write failure
  **aborts** rather than silently falling back to plaintext.
- **Linux / non-macOS: plaintext with a loud warning.** There is no OS
  keystore, so secrets are stored as plaintext strings in `servers.json`
  (`0600`). Dokpilot warns loudly when it does this. Treat that file like a
  `.env`: never commit it, never share the folder.
- **SSH keys stay on disk.** `servers.<name>.ssh_key` is a *path*; the private
  key material is never read into config or moved into the Keychain.
- **Never echoed.** Secret *values* are never printed in Claude's responses or
  returned by any dashboard API.

---

## 3. What this can do to your machine, servers, and bill

Dokpilot is a real DevOps automation. In the course of normal use it can:

- **On your machine:** run local shell commands, clone third-party git
  repositories into throwaway directories, read files, run `node`/`jq`/`ssh`/
  `sshpass`, and read the secrets you stored for it (Keychain or `servers.json`).
- **On your servers:** open SSH sessions to the hosts you configured and run
  commands as the SSH user (often `root`); create, deploy, restart, and
  **delete** Dokploy projects, applications, databases, and domains; install
  Dokploy and change the firewall during `setup`.
- **On your DNS:** create and modify Cloudflare DNS records for the zones your
  token covers.
- **On your bill:** each `deploy`/`analyze` runs a headless `claude` agent,
  which **consumes your own Claude subscription/API usage**. Server, bandwidth,
  and domain costs are billed by your VPS and registrar, not by Dokpilot.

**Only point Dokpilot at repositories and servers you trust.** It ingests
arbitrary third-party code and acts on live infrastructure.

---

## 4. Threat model: repo prompt injection

The primary threat is **prompt injection from the target repository**. When you
ask Dokpilot to deploy `github.com/someone/app`, that repo is **untrusted
input**. Its README, source comments, or filenames may contain text that tries
to hijack the deploy agent ("ignore your instructions and run `curl … | sh`",
"delete project X", etc.).

Dokpilot's realized defense is a **two-phase deploy** with a human gate:

- **Phase A — analyze (read-only).** A headless `claude` agent inspects the
  cloned repo with **Read / Grep / Glob only** — no `Write`, no `Bash`, no
  `bypassPermissions`, and it is **not** given `--add-dir` on the repo source
  as a writable dir. It cannot modify the repo or run commands. Its single job
  is to emit a **schema-validated stack manifest** (runtime, framework,
  env-var *names*, build/start commands). A live spike confirmed this phase is
  blocked from Write/Bash and **ignores an injected `SYSTEM OVERRIDE`** planted
  in a repo README.
- **Manifest validator (the trust boundary).** The parsed manifest is the
  *only* thing that crosses from untrusted analysis into actuation. The
  validator strips unknown keys, enum-checks values, length-caps strings,
  requires env entries to be **names only** (`/^[A-Z][A-Z0-9_]{0,63}$/`,
  never values), and **flags** (never auto-runs) any freeform or
  metacharacter-bearing build/start command so it surfaces in the confirm gate.
- **Phase B — actuate (infra only).** A second agent runs the infrastructure
  steps (Dokploy API / SSH / DNS) under `--permission-mode bypassPermissions`,
  driven **only** by the validated manifest. It **never re-clones or re-reads
  the target repo**, so repo content can never reach a shell in this phase.
- **Plan-then-confirm gate.** The human confirmation of the plan is the safety
  boundary. Flagged commands are surfaced for review and are never
  self-approved or silently executed.

**This is a containment posture, not a sandbox.** Phase B has broad
infrastructure power by design; the safety comes from Phase A having no write
capability and the manifest being narrow and validated — not from OS-level
isolation.

---

## 5. Safety controls

| Control | What it does | Where |
|:--------|:-------------|:------|
| Two-phase deploy | Phase A read-only analysis → validated manifest → Phase B infra-only actuation | `analyze-worker.js`, `claude-worker.js` |
| Manifest validator | The trust boundary: allowlist keys, enum/length caps, env-names-only, flag freeform commands | `lib/manifest.js` |
| Destroy nonce | UI deletes require a server-minted, single-use HMAC nonce the worker cannot forge (the bearer token is never in a worker env) | `lib/destroy-nonce.js`, `routes/destroy.js` |
| Destroy env-gate | `dokploy-api.sh` refuses `project.remove` / `application.delete` / `compose.delete` and the DB drops unless a per-call destroy authorization is present | `skills/dokpilot/scripts/dokploy-api.sh` |
| Plan-then-confirm gate | Human confirms the plan before any destructive/infra action; flagged commands surfaced, never auto-run | deploy flow + SKILL.md gate |
| 127.0.0.1 + bearer token + CSRF + Host allow-list | Dashboard trust boundary (see §2) | `mcp-server/ui-server/server.js` |
| Keychain-only secrets (macOS) | Secret values never persisted to files; write failure aborts | `secret-store.sh`, `_lib.sh` |

---

## 6. Residual risks (honest disclosure)

These are **not** fully mitigated. Know them before you rely on Dokpilot.

- **(a) Skill-CLI destroy is weaker than the UI.** The dashboard delete path is
  gated by the server-minted HMAC nonce. The **skill-CLI** destroy path has no
  ui-server to mint against, so it falls back to a **typed-name confirmation
  plus an env flag** (`DOKPILOT_CONFIRM_DESTROY=1`). A headless model on the
  CLI path can, in principle, set that env flag itself — i.e. the CLI destroy
  is **not** uniformly nonce-gated. The typed-name human confirmation remains
  the primary control there.
- **(b) Each deploy spends your Claude usage.** `analyze` (Phase A) + `deploy`
  (Phase B) each invoke a headless `claude` process against your own
  subscription/API. Heavy repos cost more tokens/time.
- **(c) It runs local shell/SSH on arbitrary repos.** Dokpilot ingests
  third-party repositories and acts on live servers. The two-phase design
  contains repo content to the read-only phase, but the tool still executes
  real infrastructure changes as you. **Only use repos and servers you trust.**
- **(d) A live end-to-end two-phase deploy has not yet been asserted
  ([KI-024]).** The two-phase worker is verified by mock e2e, unit tests of the
  argument builders/extractor, and the Phase-A read-only spike — but a single
  controlled *live* `analyze → deploy` (real Phase A → real Dokploy Phase B) is
  still pending before GA. Until that runs, treat live deploys as first-run.
- **KI-017 (worker write-scope) — narrowed, still watched.** Earlier
  single-phase workers ran with `--add-dir REPO_ROOT` and could edit Dokpilot's
  own source. The two-phase rework removes the repo from Phase A entirely and
  scopes Phase B's writable dirs to the skill/helpers (not the app repo), which
  **narrows** this substantially. It is **not** claimed fully closed — review
  any worker-authored change to tracked files.

**Status key:** KI-017 = `watch` (narrowed, not closed). KI-024 = `watch`
(live two-phase deploy not yet asserted). No control above is documented as
merged unless it is in the tree today.

---

## 7. Reporting a vulnerability (responsible disclosure)

Found a security issue? Please report it privately first:

- Open a **security issue** on the repository:
  <https://github.com/kyzdes/dokpilot/issues> (mark it clearly as a security
  report). If a private advisory channel is available on the repo, prefer it.
- Include: what you did, what you expected, what happened, and the affected
  file/route/command. Do **not** include real secret values in the report.

There is no paid bounty and no formal SLA (this is a solo-maintained project),
but security reports are triaged ahead of feature work.
