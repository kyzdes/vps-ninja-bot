# Fixed Errors — Production Deployment Issues & Solutions

This document catalogs all real-world deployment issues encountered during Dokpilot development, their root causes, and how they were resolved. Each fix is reflected in the current skill code and reference guides.

---

## Error #1: Non-existent REST endpoint for GitHub App

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** `404 Not Found` when trying to connect a GitHub repository to a Dokploy application.

**Root cause:** The API reference documented a REST endpoint `PUT applications/{id}/github` that does not exist. Dokploy uses tRPC — all mutations are HTTP POST to procedure names, not REST paths.

**Failed attempts:**
1. `PUT applications/{id}/github` → 404 (REST path doesn't exist in tRPC)
2. `PUT applications/{id}/git` → 404 (same reason)
3. `POST application.update` with `sourceType: "github"` → returned `true`, but deploy failed with "Github Provider not found" (missing `githubId`)
4. `POST application.update` with `sourceType: "git"` + `customGitUrl` → worked as fallback but lacks GitHub App auto-deploy

**Solution:** Two-step process:
```bash
# Step 1: Get GitHub provider ID
PROVIDERS=$(bash scripts/dokploy-api.sh "$SERVER" GET "gitProvider.getAll")
GITHUB_ID=$(echo "$PROVIDERS" | jq -r '[.[] | select(.providerType == "github")][0].githubId // empty')

# Step 2: Save GitHub provider for the application
bash scripts/dokploy-api.sh "$SERVER" POST application.saveGithubProvider '{
  "applicationId": "...",
  "owner": "your-name",
  "repository": "repo-name",
  "branch": "main",
  "buildPath": "/",
  "githubId": "'$GITHUB_ID'",
  "triggerType": "push",
  "enableSubmodules": false
}'
```

**Key detail:** `githubId` comes from `gitProvider.getAll` → first entry with `providerType: "github"` → use the `githubId` field (not `gitProviderId`).

**Files changed:** `SKILL.md` (GitHub App section), `references/dokploy-api-reference.md`

---

## Error #2: `saveBuildType` Zod validation failure

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** HTTP 400 with field validation errors when calling `application.saveBuildType`:

```json
{
  "fieldErrors": {
    "dockerfile": "Invalid input: expected nonoptional, received undefined",
    "herokuVersion": "Invalid input: expected nonoptional, received undefined",
    "railpackVersion": "Invalid input: expected nonoptional, received undefined"
  }
}
```

**Root cause:** The API reference only documented 4 fields (`applicationId`, `buildType`, `dockerContextPath`, `dockerBuildStage`). Dokploy v0.28 requires 3 additional fields for ALL build types — even when using Nixpacks (not Docker or Heroku). The Zod schema on the server does not make them optional.

**Solution:** Include all 7 required fields:

```json
{
  "applicationId": "...",
  "buildType": "nixpacks",
  "dockerContextPath": "/",
  "dockerBuildStage": "",
  "dockerfile": "Dockerfile",
  "herokuVersion": "24",
  "railpackVersion": "0.15.4"
}
```

**Files changed:** `references/deploy-guide.md`, `references/dokploy-api-reference.md`

---

## Error #3: `saveEnvironment` Zod validation failure

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** HTTP 400 when calling `application.saveEnvironment`:

```json
{
  "fieldErrors": {
    "buildArgs": "Invalid input: expected nonoptional, received undefined",
    "buildSecrets": "Invalid input: expected nonoptional, received undefined",
    "createEnvFile": "Invalid input: expected nonoptional, received undefined"
  }
}
```

**Root cause:** API reference only documented `applicationId` + `env`. In Dokploy v0.28, this method combines runtime env, build args, and env file management. All three additional fields are required by the Zod schema.

**Solution:** Include all 5 required fields:

```json
{
  "applicationId": "...",
  "env": "KEY=value\nKEY2=value2",
  "buildArgs": "",
  "buildSecrets": "",
  "createEnvFile": true
}
```

**Files changed:** `references/deploy-guide.md`, `references/dokploy-api-reference.md`

---

## Error #4: Node.js version mismatch for Next.js

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** Build failure — Next.js 16 requires Node >= 20, but Nixpacks selected Node 18 by default.

**Root cause:** The project's `package.json` had no `engines` field and no `.nvmrc` file. Nixpacks defaults to Node 18 without explicit version hints.

**Solution:** During deploy, the skill now:
1. Checks the `next` version in `package.json`
2. If Next.js 15+ or 16+ is detected, checks for `.nvmrc` or `engines` field
3. If missing, creates `.nvmrc` with value `20` before the first deploy
4. Also sets `NIXPACKS_NODE_VERSION=20` in environment variables

**Files changed:** `SKILL.md` (deploy section), `references/deploy-guide.md`, `references/stack-detection.md`

---

## Error #5: API timeout on `application.update`

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** `application.update` call hung for 30 seconds, then the script reported a timeout error (exit code 4). The operation actually succeeded on the server, creating uncertainty about state.

**Root cause:** `dokploy-api.sh` used a flat 30-second timeout for all endpoints. Mutation endpoints like `application.update` can take longer under load.

**Solution:**
- Dynamic timeout scaling in `dokploy-api.sh`: 60s for mutation endpoints, 30s for reads
- After a timeout on `application.update`, the skill checks the actual state via `application.one` before retrying or reporting an error

**Files changed:** `scripts/dokploy-api.sh`

---

## Error #6: `deployment.logsByDeployment` returns empty results

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** The API endpoint `deployment.logsByDeployment` returned 404 or empty results when trying to fetch build logs.

**Root cause:** This endpoint doesn't work reliably in the current Dokploy version. The API reference described it as functional, but in practice it's broken.

**Solution:** Primary log retrieval is now SSH-based:
1. Get deployment info via `deployment.all` API
2. Extract `logPath` from the response
3. Read log file directly via SSH: `bash scripts/ssh-exec.sh "$SERVER" "cat $LOG_PATH"`
4. API endpoint kept as fallback only

**Files changed:** `SKILL.md` (logs command), `references/dokploy-api-reference.md`

---

## Error #7: Local project not on GitHub

**Version:** v3.0 → Fixed in v3.1.0

**Symptom:** User said "deploy this project" pointing to a local directory. The skill expected a GitHub URL.

**Root cause:** The deploy command only accepted `github.com/user/repo` format. Real-world scenario: local project without git initialized.

**Solution:** 4-tier deployment fallback strategy:
1. **Path A:** GitHub App (if app installed + repo on GitHub)
2. **Path B:** Public git URL (if repo accessible from server)
3. **Path C:** PAT-authenticated URL (private repo, user has token)
4. **Path D:** Manual Docker build — clone locally, build Docker image on server, deploy via compose raw YAML (see `references/manual-docker-deploy.md`)

For local projects without GitHub, Path D handles the flow: create Dockerfile → transfer code to server → build on server → deploy via Docker Compose.

**Files changed:** `SKILL.md` (deployment strategy section), new file `references/manual-docker-deploy.md`

---

## Error #8: Command injection in ssh-exec.sh

**Version:** v3.1.0 → Fixed in v3.1.1

**Symptom:** Potential security vulnerability — `--bg` and `--poll` modes passed command arguments without escaping, allowing injection of arbitrary commands via crafted inputs.

**Root cause:** Shell arguments were interpolated directly into the SSH command string without sanitization.

**Solution:**
- Single-quote escaping for all command arguments passed through SSH
- Extracted `_load_server_config()` and `_run_ssh()` helper functions to centralize SSH invocation
- SSH passwords passed via `SSHPASS` environment variable instead of `-p` flag (no longer visible in `ps` output)

**Files changed:** `scripts/ssh-exec.sh`

---

## Error #9: CloudFlare multi-part TLD failure

**Version:** v3.1.0 → Fixed in v3.1.1

**Symptom:** Domains like `app.example.co.uk` failed to resolve — the script extracted `co.uk` as the zone name instead of `example.co.uk`.

**Root cause:** The TLD extraction logic split on the last two dots, which breaks for multi-part TLDs (`.co.uk`, `.com.br`, `.com.au`).

**Solution:** Instead of string manipulation for zone detection, the script now uses CloudFlare API zone lookup as a fallback: queries `GET /zones?name=<candidate>` trying progressively longer domain suffixes until a match is found.

**Files changed:** `scripts/cloudflare-dns.sh`

---

## Systemic Root Cause

Errors #1, #2, #3 share a common root cause: **the API reference was written without verifying against Dokploy's actual Zod schemas**. When Dokploy adds required fields to its validation schemas in new versions, the skill's documentation silently becomes outdated.

**Prevention:** When updating the skill for new Dokploy versions, always verify all `save*` methods against the source code at `apps/dokploy/server/api/routers/application.ts` on the Dokploy GitHub repository.
