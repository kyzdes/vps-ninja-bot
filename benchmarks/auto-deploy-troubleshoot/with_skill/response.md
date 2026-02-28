# Auto-Deploy Troubleshooting

You do **not** need to set up a webhook. Dokploy uses a built-in GitHub App integration that handles auto-deploy natively. When it is properly configured, every push to the configured branch (e.g., `main`) automatically triggers a deployment -- no webhooks, no refresh tokens, no GitHub Actions required.

If your auto-deploy has stopped working, here is the troubleshooting checklist:

## 1. Verify the GitHub App is installed

Open the Dokploy panel at `http://<server-ip>:3000`, then navigate to:

**Settings > Server > GitHub**

Confirm that the GitHub App is installed and that the repository in question has access. If the App is not installed, click **"Install GitHub App"**, select your GitHub organization/account, and choose which repositories to grant access to.

## 2. Check that `autoDeploy` is enabled

The `autoDeploy` flag on the application controls whether pushes trigger a deployment. It may have been accidentally set to `false`. You can check and re-enable it via the Dokploy API:

```bash
# Check current autoDeploy value
bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq '.autoDeploy'

# Re-enable auto-deploy if it is false
bash scripts/dokploy-api.sh <server> POST application.update '{
  "applicationId": "<id>",
  "autoDeploy": true
}'
```

## 3. Confirm you are pushing to the correct branch

The branch configured in Dokploy must match the branch you are pushing to. If Dokploy is set to deploy from `main` but you are pushing to `master` (or vice versa), auto-deploy will not trigger.

```bash
# Check which branch the application is configured to deploy from
bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq '.branch'
```

## 4. Check recent deployment history

Look at whether any deployments have been triggered recently. If there is a recent deployment, auto-deploy is working; the issue might be something else (e.g., a build failure).

```bash
bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<id>" | jq '.[0]'
```

If the latest deployment shows a `status` of `error`, check the build logs to see what went wrong:

```bash
DEPLOYMENT_ID=$(bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<id>" | jq -r '.[0].deploymentId')
bash scripts/dokploy-api.sh <server> GET "deployment.logsByDeployment?deploymentId=$DEPLOYMENT_ID"
```

## 5. Manual redeploy as a workaround

If you need to deploy immediately while troubleshooting, you can trigger a manual redeploy:

```bash
bash scripts/dokploy-api.sh <server> POST application.redeploy '{"applicationId":"<id>"}'
```

## Summary

In most cases, auto-deploy stops working because:
- The GitHub App lost access to the repository (e.g., repository permissions were changed in GitHub)
- The `autoDeploy` flag was toggled off
- The configured branch name does not match what you are pushing to

Start by checking the GitHub App installation status in Dokploy Settings, then verify the `autoDeploy` flag and branch configuration. You should not need to set up any webhooks.
