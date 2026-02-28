# GitHub App Auto-Deploy — How It Works

This is the definitive guide for how auto-deploy works in Dokploy. Read this before suggesting webhooks or manual deploy triggers to the user.

---

## Overview

Dokploy has a **built-in GitHub App integration** that handles auto-deploy natively. When configured:

- Every push to the configured branch triggers an automatic deployment
- No webhooks, no refresh tokens, no GitHub Actions needed
- Works for both public and private repositories
- Supports branch-specific deployment (e.g., push to `main` deploys production, push to `staging` deploys staging)

## How to set up (one-time, done through Dokploy UI)

1. Open Dokploy panel: `http://<server-ip>:3000`
2. Go to **Settings > Server > GitHub**
3. Click **"Install GitHub App"**
4. Select the GitHub organization/account
5. Choose which repositories to give access to (or all)
6. Confirm installation

After this, when creating applications in Dokploy, you can select repositories from the GitHub App dropdown — no manual URL entry needed.

## How auto-deploy triggers

1. Developer pushes code to the configured branch (e.g., `main`)
2. GitHub sends a webhook event to the Dokploy GitHub App (this is managed by the App itself, NOT a manual webhook)
3. Dokploy receives the event and starts a new deployment
4. The deployment builds and deploys the new code

**Branch-specific behavior:** If an application is configured to deploy from the `feature` branch, only pushes to `feature` trigger a deployment. Pushes to `main` or other branches are ignored for that application.

## What the `autoDeploy` flag does

The `autoDeploy` field in the Application API controls whether the GitHub App triggers deployments:

- `autoDeploy: true` — pushes to the configured branch trigger deployment (default after setup)
- `autoDeploy: false` — pushes are ignored; manual `application.deploy` is required

```bash
# Enable auto-deploy
bash scripts/dokploy-api.sh <server> POST application.update '{
  "applicationId": "<id>",
  "autoDeploy": true
}'

# Disable auto-deploy
bash scripts/dokploy-api.sh <server> POST application.update '{
  "applicationId": "<id>",
  "autoDeploy": false
}'
```

## When to use manual deploy

Use `application.deploy` or `application.redeploy` only when:

1. Auto-deploy is disabled and user explicitly asks to deploy
2. Initial deployment after creating the application (first deploy)
3. User wants to force a redeploy without pushing new code
4. Troubleshooting — rebuilding after env var changes

```bash
# Manual deploy (fresh build from repo)
bash scripts/dokploy-api.sh <server> POST application.deploy '{"applicationId":"<id>"}'

# Redeploy (rebuild + restart)
bash scripts/dokploy-api.sh <server> POST application.redeploy '{"applicationId":"<id>"}'
```

## Common mistakes to avoid

1. **Do NOT suggest adding a webhook URL to GitHub repository settings** — the GitHub App handles this internally
2. **Do NOT generate webhook URLs with refreshToken** — that's for non-GitHub-App setups (e.g., self-hosted Git)
3. **Do NOT create GitHub Actions workflows for deployment** — unless the user explicitly wants CI/CD beyond just deploying
4. **Do NOT ask the user to configure webhook secrets** — the GitHub App manages authentication

## After successful deploy — what to tell the user

```
Auto-deploy is active via GitHub App.
Push to `<branch>` to trigger a new deployment automatically.
No additional setup needed.
```

## Troubleshooting auto-deploy

If auto-deploy isn't triggering:

1. **Check GitHub App installation:**
   - Dokploy UI > Settings > Server > GitHub
   - Verify the App is installed and the repository has access

2. **Check autoDeploy flag:**
   ```bash
   bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq '.autoDeploy'
   ```

3. **Check the correct branch:**
   ```bash
   bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq '.branch'
   ```
   The branch configured in Dokploy must match the branch being pushed to.

4. **Check deployment history:**
   ```bash
   bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<id>" | jq '.[0]'
   ```
   If the latest deployment was triggered recently, auto-deploy is working.

## For non-GitHub repositories

If the user uses GitLab, Gitea, Bitbucket, or self-hosted Git, then manual webhook setup IS needed:

```bash
# Get webhook URL
APP_INFO=$(bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>")
REFRESH_TOKEN=$(echo "$APP_INFO" | jq -r '.refreshToken')
DOKPLOY_URL=$(jq -r ".servers.\"<server>\".dokploy_url" config/servers.json)
echo "Webhook: $DOKPLOY_URL/api/deploy/$REFRESH_TOKEN"
```

But for GitHub with GitHub App installed — this is NOT needed.
