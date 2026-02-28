# Fixing Auto-Deploy in Dokploy

Your auto-deploy likely stopped working due to one of several common causes. Here is a systematic troubleshooting guide, starting with the most likely issues and ending with the nuclear option.

---

## Step 1: Verify Auto-Deploy Is Enabled

Open your application in the Dokploy dashboard and go to the **General** tab. Confirm the **Auto Deploy** toggle is turned ON. This setting can sometimes get reset after Dokploy updates.

## Step 2: Check Branch Configuration

Dokploy only triggers auto-deploy when you push to the **exact branch** configured in the application settings. If your app is set to deploy from `main`, only pushes to `main` will trigger it. Go to your application's General settings and verify the branch is set to `main` (not `master` or something else).

## Step 3: Check GitHub Webhook Deliveries

This is the most important diagnostic step:

1. Go to your GitHub repository's **Settings > Webhooks** (or if you're using a GitHub App, go to your GitHub App settings and find the **Advanced** tab).
2. Look at the **Recent Deliveries** section.
3. Check for:
   - **Failed deliveries** (non-200 status codes) -- these indicate the webhook is not reaching your Dokploy server.
   - **No recent deliveries** -- this means the webhook is no longer configured or GitHub isn't sending events.
   - **404 responses** -- this usually means your Dokploy server URL changed but the webhook still points to the old URL.
   - **Timeouts or connection errors** -- your VPS may be unreachable from GitHub (firewall, Cloudflare rules, etc.).

## Step 4: Verify Your Dokploy Server URL

A very common cause of auto-deploy breaking is **changing your Dokploy server's domain or IP address**. When you change the Dokploy URL:

- GitHub still has the OLD webhook URL registered.
- Webhook deliveries will fail with 404 errors.
- The fix requires either updating the webhook URL in GitHub or recreating the application in Dokploy.

**To fix this:** If you changed your domain/IP, you need to update the webhook URL in your GitHub repository settings to point to your current Dokploy server address.

## Step 5: Check Network/Firewall Rules

If you're using Cloudflare or any firewall in front of your VPS, make sure GitHub's webhook IPs are not being blocked. Users have reported that Cloudflare security rules can silently block GitHub webhook deliveries. You can find GitHub's webhook IP ranges in their documentation: https://api.github.com/meta (look for the `hooks` array).

## Step 6: Re-authenticate the GitHub Connection

GitHub App tokens expire periodically (user access tokens expire after 8 hours, refresh tokens after 6 months). If your Dokploy GitHub connection has stale credentials:

1. Go to **Dokploy Settings > Git Providers** (or equivalent in your version).
2. Disconnect and reconnect your GitHub account/app.
3. This will refresh the authentication tokens.

## Step 7: Manually Configure a Webhook (If Automatic Setup Failed)

If the automatic GitHub integration isn't working, you can set up a webhook manually:

1. In Dokploy, go to your application's **Deployments** tab.
2. Find and copy the **Webhook URL** (it looks something like `https://your-dokploy-domain/api/deploy/github`).
3. Go to your GitHub repository > **Settings > Webhooks > Add webhook**.
4. Set:
   - **Payload URL**: paste the Dokploy webhook URL
   - **Content type**: `application/json`
   - **Events**: select "Just the push event"
   - **Active**: make sure it's checked
5. Save the webhook.
6. Push a commit to `main` and check if the delivery succeeds.

## Step 8: Alternative -- Use the Dokploy API for CI/CD

If webhooks continue to be unreliable, you can trigger deployments via the Dokploy API from a GitHub Actions workflow:

1. **Generate an API token** in Dokploy (Profile settings).
2. **Find your Application ID** by calling:
   ```bash
   curl -X GET 'https://your-dokploy-domain/api/project.all' \
     -H 'accept: application/json' \
     -H 'x-api-key: YOUR_TOKEN'
   ```
3. **Create a GitHub Actions workflow** (`.github/workflows/deploy.yml`):
   ```yaml
   name: Deploy to Dokploy
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - name: Trigger Dokploy deployment
           run: |
             curl -X POST 'https://your-dokploy-domain/api/application.deploy' \
               -H 'accept: application/json' \
               -H 'Content-Type: application/json' \
               -H 'x-api-key: ${{ secrets.DOKPLOY_API_TOKEN }}' \
               -d '{"applicationId": "YOUR_APP_ID"}'
   ```
4. Add `DOKPLOY_API_TOKEN` as a secret in your GitHub repository settings.

This approach is more reliable than webhooks because it doesn't depend on Dokploy's webhook endpoint being reachable -- GitHub Actions initiates the connection outbound.

## Step 9: Nuclear Option -- Recreate the Application

If nothing else works, some users have resolved persistent auto-deploy issues by:

1. Noting down all your current application settings (environment variables, domains, build settings, etc.).
2. Deleting the application in Dokploy.
3. Creating a new application with the same repository and settings.
4. Enabling Auto Deploy on the new application.

This forces Dokploy to register a fresh webhook with GitHub.

---

## Summary of Most Common Causes

| Cause | Fix |
|-------|-----|
| Auto-deploy toggle turned off | Re-enable it in General settings |
| Branch mismatch | Set the correct branch in Dokploy |
| Dokploy domain/IP changed | Update webhook URL in GitHub |
| Firewall blocking GitHub | Whitelist GitHub webhook IPs |
| Expired GitHub tokens | Reconnect GitHub in Dokploy settings |
| Webhook not configured | Manually add webhook in GitHub repo settings |
| Persistent bug | Use API-based deployment via GitHub Actions |

---

## Sources

- [Dokploy Auto Deploy Documentation](https://docs.dokploy.com/docs/core/auto-deploy)
- [Dokploy Webhook Documentation](https://docs.dokploy.com/docs/core/webhook)
- [GitHub Issue #3787: Automatic GitHub Deployment Not Triggering](https://github.com/Dokploy/dokploy/issues/3787)
- [GitHub Issue #2645: Webhook responds 404](https://github.com/Dokploy/dokploy/issues/2645)
- [GitHub Issue #741: Auto-deploy doesn't work with GitHub organizations](https://github.com/Dokploy/dokploy/issues/741)
- [GitHub Discussion #186: GitHub App webhook & autodeploy](https://github.com/Dokploy/dokploy/discussions/186)
- [GitHub Discussion #142: Automatic deploy with webhook error](https://github.com/Dokploy/dokploy/discussions/142)
