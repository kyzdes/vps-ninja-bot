# Design Spec — Dokpilot Secret Storage

Historical design document for the macOS Keychain-backed secret store that shipped in v3.2.0 and was renamed to service `dokpilot` in v4.0.0. Kept as a record for future contributors; runtime documentation lives in `skills/dokpilot/references/secrets-management.md`.

## Context

Before v3.2.0, every Dokpilot secret sat in `~/.claude/skills/dokpilot/config/servers.json` as plaintext:

- `servers.<name>.dokploy_api_key` — Dokploy API key (full root access to the VPS)
- `servers.<name>.ssh_key` — path to the private SSH key
- `cloudflare.api_token` — CloudFlare API token (full DNS-zone access)

Any process or agent with read access to `~/.claude/` could grab all of these tokens. That violates "secrets live in the system secret store, not in plain JSON". The goal of this work: let the user keep secrets in **macOS Keychain** while preserving existing installs.

## Goals & Principles

1. **Optional, not forced.** Keychain is the recommendation; pre-existing plain-string configs continue to work unchanged.
2. **Transparent to scripts.** `dokploy-api.sh`, `cloudflare-dns.sh`, and `ssh-exec.sh` do not branch on source — they call a single `secret-store.sh` shim.
3. **macOS-only.** Linux/Windows users keep file-based secrets; Keychain is unavailable there.
4. **Secure default UX.** During `config server add` / `config cloudflare`, the skill offers Keychain first; falling back to file storage is an explicit user choice.

## Scope / Non-Goals

**In scope:**
- New `scripts/secret-store.sh` (wrapper over the `security` CLI).
- Adapt the three existing scripts (`cloudflare-dns.sh`, `dokploy-api.sh`, `ssh-exec.sh`) so they resolve secret values via `secret-store.sh`.
- Update `/dokpilot config` commands in `SKILL.md` (hidden-input prompt, new `config migrate-to-keychain` command).
- New `references/secrets-management.md` — user-facing guide.
- One updated eval scenario + two new eval cases.

**Not in scope:**
- Linux Secret Service (`secret-tool`), 1Password CLI, age, or Vault backends — possible future additions through the same `secret-store.sh` abstraction.
- Key rotation (use `config remove` + `config add` again).
- Encrypting `servers.json` wholesale — only secrets move out; the rest of the file is non-sensitive.

## Storage architecture

### `config/servers.json` format after migration

Secret fields are replaced by a reference of the shape `{"_secret": "<keychain-account>"}`:

```json
{
  "servers": {
    "main": {
      "host": "203.0.113.10",
      "ssh_user": "root",
      "ssh_key": "/Users/.../id_rsa",
      "dokploy_url": "http://203.0.113.10:3000",
      "dokploy_api_key": { "_secret": "main:dokploy_api_key" },
      "added_at": "2026-02-19T11:15:00Z"
    }
  },
  "cloudflare": {
    "api_token": { "_secret": "cloudflare:api_token" }
  },
  "defaults": { "server": "main" }
}
```

**Legacy plain-string form** is still supported: if the field is a string, it is used as-is.

### Keychain item naming

- `service` (fixed): `dokpilot`
- `account` (dynamic):
  - per-server: `<server-name>:<field>` — e.g. `main:dokploy_api_key`
  - cloudflare: `cloudflare:api_token`
- `comment`: `Created by dokpilot skill on <ISO date>`

Read command:

```bash
security find-generic-password -s dokpilot -a "main:dokploy_api_key" -w
```

Write command:

```bash
security add-generic-password -U -s dokpilot -a "main:dokploy_api_key" -w "<token>" \
  -j "Created by dokpilot skill on 2026-04-19"
# -U → update if exists; we deliberately omit -T so access requires an explicit user prompt
```

> **Decision on `-T`:** We do NOT add `-T /usr/bin/security` or any other binary. On first access from a terminal, macOS shows the system permission dialog; the user clicks "Always Allow" once and never sees it again. This is safer than pre-authorising arbitrary callers.

## `/dokpilot config` UX

### `config server add <name> <ip> [--ssh-key <path>]`

1. Save public fields (`host`, `ssh_user`, `ssh_key`, `dokploy_url`, `added_at`) to `servers.json` as before.
2. Prompt for the Dokploy API key with hidden input:
   `read -s -p "Dokploy API key for <name> (input hidden, leave empty to skip): "`
3. If a value was entered, ask **where to store it**:
   - macOS with `security` available → default **Keychain**, option `p` to store as plain string in the file.
   - Other OSes → file-only, no prompt.
4. Save via `secret-store.sh set "<name>:dokploy_api_key" "<token>"`.
5. In `servers.json` write `{"_secret": "<name>:dokploy_api_key"}`.

### `config cloudflare <api-token>`

- Token passed as argument → store immediately in Keychain (most secure default) and write the reference.
- No argument → hidden-input prompt, same flow.
- The argument form is kept for compatibility but prints a warning: "token may have leaked into shell history; consider removing or using the no-argument form".

### `config server remove <name>`

In addition to the existing behaviour, delete the related Keychain items (`<name>:*`) after explicit `Y/n` confirmation.

### `config migrate-to-keychain` (new command)

Walks the existing `servers.json`:

1. Finds every secret field whose value is still a string (not a `{_secret}` reference).
2. For each: writes it to the Keychain → replaces it in the JSON with a reference.
3. Saves a backup at `servers.json.pre-keychain-<timestamp>` alongside.
4. Prints a report: migrated vs. skipped.

### `config` (no arguments)

Replaces the existing plain `jq` dump with a per-secret source report:

```
servers.main.dokploy_api_key  → keychain (dokpilot / main:dokploy_api_key)
servers.main.ssh_key           → file (path)
cloudflare.api_token           → keychain (dokpilot / cloudflare:api_token)
defaults.server                → main
```

Actual secret values are never printed.

## Implementation — specific edits

### New `scripts/secret-store.sh`

```text
Usage:
  secret-store.sh get <account>            → prints secret to stdout (exit 1 if not found)
  secret-store.sh set <account> <value>    → write; -U updates if exists
  secret-store.sh delete <account>         → remove
  secret-store.sh list                     → list accounts under service=dokpilot
  secret-store.sh available                → exit 0 if security CLI is usable; otherwise 1

Internals:
  - Checks `command -v security` and uname=Darwin
  - Service constant = "dokpilot"
  - Maps all `security` errors to readable messages
  - On write: -U (update), no -T (force prompt at first access)
```

### `scripts/cloudflare-dns.sh`

Replace the direct `jq` read with `resolve_secret`:

```bash
TOKEN=$(resolve_secret '.cloudflare.api_token')
```

### `scripts/dokploy-api.sh`

```bash
URL=$(jq -r ".servers.\"$SERVER\".dokploy_url // empty" "$CONFIG")   # public — read as-is
KEY=$(resolve_secret ".servers.\"$SERVER\".dokploy_api_key")
```

The header-passing line is unchanged; the variable name is the same.

### `scripts/ssh-exec.sh`

`host` and `ssh_user` stay public. `ssh_key` is the file path (not the key itself), so it stays in the JSON for now:

```bash
HOST=$(jq -r ".servers.\"$server_name\".host // empty" "$config")
USER=$(jq -r ".servers.\"$server_name\".ssh_user // \"root\"" "$config")
SSH_KEY=$(jq -r ".servers.\"$server_name\".ssh_key // empty" "$config")
```

### Shared `scripts/_lib.sh`

```bash
resolve_secret() {
  local jq_path="$1"
  local raw=$(jq -c "$jq_path // empty" "$CONFIG")
  [ -z "$raw" ] && return 1
  # Object form: {"_secret": "<account>"}
  local account=$(echo "$raw" | jq -r '._secret // empty')
  if [ -n "$account" ]; then
    bash "$SCRIPT_DIR/secret-store.sh" get "$account"
  else
    echo "$raw" | jq -r '.'
  fi
}
```

## Status

- Shipped in **v3.2.0** (2026-04-19) under Keychain service `vps-ninja`.
- Service renamed to `dokpilot` in **v4.0.0** (2026-05-24) as part of the project rebrand. No data migration shipped — at rebrand time the user had no Keychain items yet (the feature had just landed). Future rebrand-aware re-migration is out of scope.
