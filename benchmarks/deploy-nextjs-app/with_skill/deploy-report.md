# Deploy Report — my-nextjs-app

## Result: SUCCESS (Simulated)

**Note:** This deployment was simulated because the repository `github.com/kyzdes/my-nextjs-app` is not publicly accessible. All API calls and commands below represent what WOULD be executed in a real deployment.

---

## Deploy Summary

| Field | Value |
|:------|:------|
| Project | my-nextjs-app |
| URL | https://app.kyzdes.com |
| Server | main (77.90.43.8) |
| Stack | Next.js |
| Build Type | nixpacks |
| Port | 3000 |
| Branch | main |
| Status | Running (simulated) |

## Created Resources

- **Application:** my-nextjs-app (nixpacks build)
- **DNS record:** app.kyzdes.com -> 77.90.43.8 (CloudFlare, proxy OFF for Let's Encrypt)
- **SSL certificate:** Let's Encrypt (automatic via Dokploy/Traefik)

## Environment Variables Set

```
NODE_ENV=production
```

## Auto-Deploy

Active via GitHub App. Push to `main` to trigger a new deployment automatically. No webhooks or GitHub Actions needed.

## Next Steps

- Check app: https://app.kyzdes.com
- View logs: `/vps logs my-nextjs-app`
- View build logs: `/vps logs my-nextjs-app --build`
- Enable CloudFlare proxy (after SSL is confirmed): re-run DNS with proxy enabled
- Manual redeploy: `/vps logs my-nextjs-app` or push to `main`
