# Secrets Management

Dokpilot handles two kinds of sensitive credentials:

| Credential | Scope of access |
|:-----------|:----------------|
| Dokploy API key (per server) | Full control of the server's Dokploy panel |
| CloudFlare API token | DNS edits on every zone the token covers |

On macOS, both live in the system Keychain by default. `servers.json` holds only
a reference. On other platforms (or when the user opts out), they stay as plain
strings in `servers.json`, exactly as in v3.1.

---

## Storage formats

### Plain (legacy)

```json
{
  "servers": {
    "main": { "dokploy_api_key": "dk_abc123..." }
  },
  "cloudflare": { "api_token": "cf_xyz789..." }
}
```

Still supported. Existing installations keep working without any changes.

### Keychain reference

```json
{
  "servers": {
    "main": { "dokploy_api_key": { "_secret": "main:dokploy_api_key" } }
  },
  "cloudflare": { "api_token": { "_secret": "cloudflare:api_token" } }
}
```

The `_secret` string is the **account** name under service `dokpilot` in the
Keychain. Naming convention:

- `<server-name>:<field>` for per-server secrets (e.g. `main:dokploy_api_key`)
- `cloudflare:<field>` for CloudFlare secrets

The skill resolves references transparently through `scripts/secret-store.sh`
and `scripts/_lib.sh::resolve_secret()`.

---

## First-time prompt

When the calling binary (bash, Terminal, Claude Code) first reads a stored item,
macOS shows a system dialog:

> **"dokpilot" wants to use your confidential information stored in "main:dokploy_api_key" in your keychain.**
> **[Deny] [Allow] [Always Allow]**

Pick **Always Allow** to whitelist the binary. The dialog never appears again
for that item + binary combination. We deliberately do **not** pass `-T` when
writing items, so the default ACL is tight.

---

## Commands

### Store a new secret

Via the skill:

```
/dokpilot config server add main 203.0.113.10
# prompts (hidden) for the API key, asks Keychain vs file
```

Or manually:

```bash
bash scripts/secret-store.sh set "main:dokploy_api_key" "<token>"
```

### Read a secret

```bash
bash scripts/secret-store.sh get "main:dokploy_api_key"
```

### Delete a secret

```bash
bash scripts/secret-store.sh delete "main:dokploy_api_key"
```

### Check availability

```bash
bash scripts/secret-store.sh available && echo "Keychain available"
```

Exit 0 on macOS with `security` in `$PATH`. Exit 1 otherwise.

### Migrate existing installations

```
/dokpilot config migrate-to-keychain
```

Moves every plain-string secret in `servers.json` into the Keychain, rewrites
the file to use `_secret` references, and leaves a backup at
`config/servers.json.pre-keychain-<ISO-date>`.

---

## Rotating a token

1. Issue a new token in the relevant provider (Dokploy UI or CloudFlare dashboard).
2. Overwrite the Keychain item:
   ```bash
   bash scripts/secret-store.sh set "main:dokploy_api_key" "<new-token>"
   ```
   `set` uses `security add-generic-password -U`, so it updates in place.
3. Revoke the old token in the provider UI.

No changes to `servers.json` required — the reference is stable.

---

## Revoking access for a binary

Open **Keychain Access.app** → search for `dokpilot` → select the item →
**Access Control** tab → remove the application from the allow list. The next
call will re-prompt.

---

## Rolling back to plain storage

If you need to move a secret from Keychain back into the file (for example, to
ship the config to a non-macOS machine):

```bash
VALUE=$(bash scripts/secret-store.sh get "main:dokploy_api_key")
# Edit config/servers.json manually, replacing
#   "dokploy_api_key": {"_secret": "main:dokploy_api_key"}
# with
#   "dokploy_api_key": "<value>"
bash scripts/secret-store.sh delete "main:dokploy_api_key"
```

---

## Troubleshooting

### Keychain is locked

```
security: SecKeychainItemCopyAccess: The user name or passphrase you entered is not correct.
```

Unlock the login keychain:

```bash
security unlock-keychain ~/Library/Keychains/login.keychain-db
```

Or log out and back in.

### `secret-store.sh: Secret not found`

The account name does not exist under service `dokpilot`. List what is stored:

```bash
bash scripts/secret-store.sh list
```

If the item is missing, re-run `/dokpilot config server add <name>` or
`/dokpilot config cloudflare`.

### Running on Linux / Windows

Keychain storage is macOS only. On other platforms:

- `secret-store.sh available` exits 1.
- `/dokpilot config server add` and `/dokpilot config cloudflare` save plain strings.
- `/dokpilot config migrate-to-keychain` refuses to run.
- Everything else works as it did in v3.1.

---

## SSH private keys

`servers.<name>.ssh_key` is a **path** on disk, not the key material. We do not
move it into the Keychain — the private key stays in `~/.ssh/` under
`chmod 600`. If you want the passphrase stored, use the standard approach:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

This is macOS's system-wide integration and is unaffected by Dokpilot.

---

## Smoke test

```bash
# 1. Write
bash scripts/secret-store.sh set "test:token" "hello"

# 2. Read
[ "$(bash scripts/secret-store.sh get 'test:token')" = "hello" ] && echo OK

# 3. Delete
bash scripts/secret-store.sh delete "test:token"

# 4. End-to-end (real server required)
bash scripts/cloudflare-dns.sh list example.com | head
bash scripts/dokploy-api.sh main GET project.all | jq 'length'
```
