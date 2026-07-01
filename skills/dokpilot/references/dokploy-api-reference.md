# Dokploy API Reference

> **CRITICAL: Dokploy uses tRPC — ALL mutations use HTTP POST**
>
> Despite conventional REST naming, Dokploy's API is built on tRPC.
> ALL endpoints that modify data (create, update, delete, deploy, save*) use POST.
> Only read-only endpoints (*.one, *.all, *.version) use GET.
> There are NO PUT or DELETE HTTP methods in the Dokploy API.

Reference for the main Dokploy REST API endpoints used by Dokpilot.

Full documentation: https://docs.dokploy.com/docs/api

> **Version:** Current for Dokploy v0.29+. Earlier versions may have different endpoints and response shapes.

---

## Authentication

Every request requires the HTTP header:
```
x-api-key: <your-api-key>
```

Generate the API key in the Dokploy UI: Settings → Profile → API/CLI → Generate API Key

> **Note:** In v0.27+, the `auth.createUser` / `auth.createAdmin` endpoints were removed. The admin account is created ONLY through the UI at `http://IP:3000` on first launch.

---

## Base URL

```
http://<server-ip>:3000/api
```

Or with a domain:
```
https://panel.example.com/api
```

---

## Projects

### `POST project.create`

Create a new project (top-level container for applications and databases).

**Request:**
```json
{
  "name": "my-project",
  "description": "Project description"
}
```

**Response (v0.27+):**

> **Important:** The response is nested — it contains both `project` and `environment` objects.

```json
{
  "project": {
    "projectId": "abc123",
    "name": "my-project",
    "description": "...",
    "createdAt": "2026-02-17T..."
  },
  "environment": {
    "environmentId": "env456",
    "name": "Production",
    "projectId": "abc123"
  }
}
```

**Extracting data:**
```bash
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')
```

> `environmentId` is required when creating applications, databases, and Compose projects inside this project.

### `GET project.all`

List all projects (with nested applications, databases, and domains).

**Response:**
```json
[
  {
    "projectId": "abc123",
    "name": "my-project",
    "applications": [
      {
        "applicationId": "app1",
        "name": "frontend",
        "applicationStatus": "running",
        "domains": [...]
      }
    ],
    "postgres": [...],
    "mysql": [...],
    "mariadb": [...],
    "mongo": [...],
    "redis": [...]
  }
]
```

### `POST project.remove`

Delete a project (along with all nested resources).

**Request:**
```json
{
  "projectId": "abc123"
}
```

---

## Applications

### `POST application.create`

Create an application inside a project.

**Request (v0.27+):**
```json
{
  "name": "my-app",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Required:** `environmentId` is a required field in v0.27+. Obtain it from the `project.create` response (`environment.environmentId`) or from `project.all`.

**Response:**
```json
{
  "applicationId": "app1",
  "name": "my-app",
  "projectId": "abc123",
  "sourceType": null,
  "buildType": null
}
```

### `POST application.update`

Update application settings (autoDeploy and other flags).

**Request:**
```json
{
  "applicationId": "app1",
  "autoDeploy": true
}
```

---

## Git Providers

### `GET gitProvider.getAll`

Get all configured git providers (GitHub App, GitLab, Bitbucket, Gitea).

**Response:**
```json
[
  {
    "gitProviderId": "gp1",
    "providerType": "github",
    "githubId": "gh123",
    "name": "Dokploy-2026-02-19-xxxxx",
    "createdAt": "2026-02-19T..."
  }
]
```

> Use `githubId` (NOT `gitProviderId`) when calling `application.saveGithubProvider`.
> If the array is empty or has no entry with `providerType: "github"`, the GitHub App is not installed.

### `POST application.saveGithubProvider`

Configure GitHub repository via the installed GitHub App. Requires `githubId` from `gitProvider.getAll`.

**Prerequisites:**
1. GitHub App must be installed in Dokploy (Settings > Server > GitHub)
2. Get `githubId`: `GET gitProvider.getAll` -> find entry with `providerType: "github"` -> use `.githubId`

**Request:**
```json
{
  "applicationId": "app1",
  "owner": "github-user-or-org",
  "repository": "repo-name",
  "branch": "main",
  "buildPath": "/",
  "githubId": "<from gitProvider.getAll>",
  "triggerType": "push",
  "enableSubmodules": false
}
```

> **Field notes:**
> - `repository` is the repo name only (not a URL, not `owner/repo`)
> - `githubId` is from `gitProvider.getAll`, NOT `gitProviderId`
> - `triggerType`: "push" for auto-deploy on push
> - `buildPath`: "/" for root, or "/packages/frontend" for monorepo

**Response:**
```json
{
  "message": "GitHub configuration saved successfully."
}
```

### Using `application.update` for Git source (no GitHub App)

When GitHub App is not installed, configure the git source via `application.update`:

**For public repos:**
```json
POST application.update
{
  "applicationId": "app1",
  "sourceType": "git",
  "customGitUrl": "https://github.com/user/repo.git",
  "customGitBranch": "main"
}
```

**For private repos with PAT:**
```json
POST application.update
{
  "applicationId": "app1",
  "sourceType": "git",
  "customGitUrl": "https://<PAT>@github.com/user/repo.git",
  "customGitBranch": "main"
}
```

> **WARNING:** Do NOT use `sourceType: "github"` without first calling
> `application.saveGithubProvider` with a valid `githubId`.
> Using `sourceType: "github"` alone triggers "Github Provider not found" on deploy.
>
> **WARNING:** `file://` URLs are NOT supported by Dokploy. Only `https://` and `ssh://` URLs work.

### `POST application.saveBuildType`

Set the build type.

**Request (v0.28+):**
```json
{
  "applicationId": "app1",
  "buildType": "nixpacks",
  "dockerfile": "Dockerfile",
  "dockerContextPath": "",
  "dockerBuildStage": "",
  "herokuVersion": "24",
  "railpackVersion": "0.15.4"
}
```

> **REQUIRED (v0.28+):** All seven fields are mandatory regardless of build type.
> Even for `nixpacks` builds, `dockerfile`, `herokuVersion`, and `railpackVersion`
> must be present with default values. The Zod schema rejects requests missing any of these.

For `dockerfile`, you can pass real values:
```json
{
  "applicationId": "app1",
  "buildType": "dockerfile",
  "dockerfile": "Dockerfile",
  "dockerContextPath": ".",
  "dockerBuildStage": "",
  "herokuVersion": "24",
  "railpackVersion": "0.15.4"
}
```

Allowed `buildType` values: `nixpacks`, `dockerfile`, `railpack`, `heroku_buildpacks`, `paketo_buildpacks`, `static`.

### `POST application.saveEnvironment`

Set environment variables.

**Request (v0.28+):**
```json
{
  "applicationId": "app1",
  "env": "DATABASE_URL=postgresql://...\nNODE_ENV=production\nSECRET_KEY=abc123",
  "buildArgs": "",
  "buildSecrets": "",
  "createEnvFile": true
}
```

> **REQUIRED (v0.28+):** Fields `buildArgs`, `buildSecrets`, and `createEnvFile` are mandatory.
> Without them, the Zod schema returns HTTP 400 with fieldErrors.

`env` format: `KEY=VALUE` pairs separated by `\n` (newline).

### `POST application.deploy`

Trigger a deploy of the application.

**Request:**
```json
{
  "applicationId": "app1"
}
```

**Response:**
```json
{
  "deploymentId": "deploy1"
}
```

### `POST application.stop`

Stop the application.

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.start`

Start the application (after a stop).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.redeploy`

Redeploy the application (rebuild + restart).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `GET application.one`

Get information about a single application.

**Request (query params):**
```
?applicationId=app1
```

**Response:**
```json
{
  "applicationId": "app1",
  "name": "my-app",
  "applicationStatus": "running",
  "sourceType": "github",
  "repository": "https://github.com/user/repo",
  "branch": "main",
  "buildType": "nixpacks",
  "env": "DATABASE_URL=...",
  "domains": [...],
  "refreshToken": "abc123..."
}
```

### `POST application.delete`

Delete the application.

**Request:**
```json
{
  "applicationId": "app1"
}
```

---

## Docker Compose

### `POST compose.create`

Create a compose project.

**Request (v0.27+):**
```json
{
  "name": "my-compose",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Required:** `environmentId` is a required field in v0.27+.

**Response:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.saveGithubProvider`

Configure a GitHub repository for a compose project via the GitHub App. Same as `application.saveGithubProvider`.

**Request:**
```json
{
  "composeId": "comp1",
  "owner": "user",
  "repository": "repo-name",
  "branch": "main",
  "composePath": "docker-compose.yml",
  "githubId": "<from gitProvider.getAll>"
}
```

### `POST compose.update`

Update settings of a compose project (composePath, raw YAML and other flags).

> **IMPORTANT:** To configure the GitHub repository, use `compose.saveGithubProvider` (requires `githubId` from `gitProvider.getAll`).

**For raw mode (inline YAML):**
```json
{
  "composeId": "comp1",
  "sourceType": "raw",
  "composePath": "docker-compose.yml",
  "composeFile": "services:\n  app:\n    image: my-app:latest\n    ports:\n      - '3000:3000'\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}
```

> **CRITICAL:** The YAML field is `composeFile`, NOT `customCompose`.
> Using `customCompose` is silently ignored — an empty docker-compose.yml is created and the deploy fails with "Compose file not found".

> **Raw mode** is used when there is no Git repository: locally built images, private repos without a token, or custom multi-container configurations.

### `POST compose.deploy`

Deploy a compose project.

**Request:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.remove`

Delete a compose project.

**Request:**
```json
{
  "composeId": "comp1"
}
```

---

## Auto-deploy (GitHub App)

Dokploy uses a built-in GitHub App for auto-deploy. When installed (Dokploy UI > Settings > Server > GitHub), pushes to the configured branch trigger automatic deployment. **No manual webhooks needed.**

### Enable/disable auto-deploy

```json
POST application.update
{
  "applicationId": "app1",
  "autoDeploy": true
}
```

### How it works

1. GitHub App is installed once in Dokploy UI
2. App receives push events from GitHub automatically
3. If `autoDeploy: true` and the push is to the configured branch, deployment triggers

### For non-GitHub providers only (GitLab, Gitea, Bitbucket)

If NOT using GitHub App, manual webhook setup is needed:

```bash
# Get refresh token
REFRESH_TOKEN=$(bash scripts/dokploy-api.sh <server> GET "application.one?applicationId=<id>" | jq -r '.refreshToken')

# Webhook URL for applications
echo "https://<dokploy-url>/api/deploy/$REFRESH_TOKEN"

# Webhook URL for compose
echo "https://<dokploy-url>/api/deploy/compose/$REFRESH_TOKEN"
```

> **For GitHub repositories with GitHub App installed, do NOT use webhooks.** The App handles everything.

---

## Domains

### `POST domain.create`

Add a domain to an application.

**Request:**
```json
{
  "applicationId": "app1",
  "host": "app.example.com",
  "port": 3000,
  "https": true,
  "path": "/",
  "certificateType": "letsencrypt"
}
```

> **Important:** The DNS A record must be created and propagated BEFORE calling `domain.create` with `certificateType: "letsencrypt"`. Otherwise the ACME challenge fails and the certificate is not issued. Order: DNS → Domain → Deploy.

**Response:**
```json
{
  "domainId": "dom1",
  "host": "app.example.com",
  "port": 3000,
  "https": true
}
```

### `POST domain.delete`

Delete a domain.

**Request:**
```json
{
  "domainId": "dom1"
}
```

---

## Databases — PostgreSQL

### `POST postgres.create`

Create a PostgreSQL database.

**Request (v0.27+):**
```json
{
  "name": "my-db",
  "projectId": "abc123",
  "environmentId": "env456",
  "databaseName": "myapp",
  "databaseUser": "myapp",
  "databasePassword": "secure-password"
}
```

> **Required:** `environmentId` and `databasePassword` are required fields in v0.27+.

**Response:**
```json
{
  "postgresId": "pg1",
  "name": "my-db"
}
```

### `POST postgres.deploy`

Start PostgreSQL (after creating or stopping).

**Request:**
```json
{
  "postgresId": "pg1"
}
```

### `GET postgres.one`

Get information about a PostgreSQL instance, including connection strings.

**Request (query params):**
```
?postgresId=pg1
```

**Response:**
```json
{
  "postgresId": "pg1",
  "name": "my-db",
  "databaseName": "myapp",
  "databaseUser": "myapp",
  "internalDatabaseUrl": "postgresql://myapp:password@my-db:5432/myapp",
  "externalDatabaseUrl": "postgresql://myapp:password@203.0.113.10:5432/myapp"
}
```

### `POST postgres.remove`

Delete a PostgreSQL database.

**Request:**
```json
{
  "postgresId": "pg1"
}
```

---

## Databases — MySQL

Same shape as PostgreSQL, but with these endpoints:
- `POST mysql.create` (requires `environmentId`, `databasePassword`)
- `POST mysql.deploy`
- `GET mysql.one`
- `POST mysql.remove`

---

## Databases — MariaDB

- `POST mariadb.create` (requires `environmentId`, `databasePassword`)
- `POST mariadb.deploy`
- `GET mariadb.one`
- `POST mariadb.remove`

---

## Databases — MongoDB

- `POST mongo.create` (requires `environmentId`, `databasePassword`)
- `POST mongo.deploy`
- `GET mongo.one`
- `POST mongo.remove`

---

## Databases — Redis

### `POST redis.create`

**Request (v0.27+):**
```json
{
  "name": "my-redis",
  "projectId": "abc123",
  "environmentId": "env456",
  "databasePassword": "secure-password"
}
```

> **Required:** `environmentId` and `databasePassword` are required fields in v0.27+.

**Response:**
```json
{
  "redisId": "redis1",
  "name": "my-redis"
}
```

### `POST redis.deploy`

**Request:**
```json
{
  "redisId": "redis1"
}
```

### `GET redis.one`

**Request (query params):**
```
?redisId=redis1
```

### `POST redis.remove`

**Request:**
```json
{
  "redisId": "redis1"
}
```

---

## Deployments

### `GET deployment.all`

List all deployments for an application.

**Request (query params):**
```
?applicationId=app1
```

**Response:**
```json
[
  {
    "deploymentId": "deploy1",
    "status": "done",
    "createdAt": "2026-02-17T...",
    "finishedAt": "2026-02-17T..."
  }
]
```

### `GET deployment.logsByDeployment`

Get the logs of a deployment.

> **NOTE:** This endpoint may not work in some Dokploy versions.
> **Primary method:** Read logs via SSH using the `logPath` returned by `deployment.all`:
> ```bash
> LOG_PATH=$(echo "$RESPONSE" | jq -r '.[0].logPath')
> bash scripts/ssh-exec.sh "$SERVER" "cat $LOG_PATH"
> ```
> Use the API endpoint only as a fallback.

**Request (query params):**
```
?deploymentId=deploy1
```

**Response:**
```
Build logs as plain text...
```

---

## Settings

### `GET settings.version`

Get the Dokploy version.

**Response:**
```json
{
  "version": "v0.27.0"
}
```

---

## Usage examples

### Create a project and deploy a Next.js application (v0.27+)

```bash
# 1. Create the project (response is nested!)
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-saas"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Create PostgreSQL (requires environmentId and databasePassword)
PG=$(bash scripts/dokploy-api.sh main POST postgres.create '{
  "name":"my-saas-db",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'",
  "databasePassword":"'"$(openssl rand -base64 16)"'",
  "databaseUser":"mysaas",
  "databaseName":"mysaas"
}')
PG_ID=$(echo "$PG" | jq -r '.postgresId')

# 3. Deploy PostgreSQL
bash scripts/dokploy-api.sh main POST postgres.deploy '{"postgresId":"'"$PG_ID"'"}'

# 4. Get the connection string
PG_INFO=$(bash scripts/dokploy-api.sh main GET "postgres.one?postgresId=$PG_ID")
DB_URL=$(echo "$PG_INFO" | jq -r '.internalDatabaseUrl')

# 5. Create the application (requires environmentId)
APP=$(bash scripts/dokploy-api.sh main POST application.create '{
  "name":"my-saas",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
APP_ID=$(echo "$APP" | jq -r '.applicationId')

# 6. Configure GitHub (via the GitHub App — if installed)
# v0.29+ (shared providers, KI-012/G-016): id nested at .github.githubId; top-level null.
GITHUB_ID=$(bash scripts/dokploy-api.sh main GET "gitProvider.getAll" | \
  jq -r '[.[] | select(.providerType == "github")][0] | (.github.githubId // .githubId) // empty')

if [ -n "$GITHUB_ID" ]; then
  bash scripts/dokploy-api.sh main POST application.saveGithubProvider '{
    "applicationId":"'"$APP_ID"'",
    "owner":"user",
    "repository":"my-saas",
    "branch":"main",
    "buildPath":"/",
    "githubId":"'"$GITHUB_ID"'",
    "triggerType":"push",
    "enableSubmodules":false
  }'
else
  # Fallback: customGitUrl for public repos
  bash scripts/dokploy-api.sh main POST application.update '{
    "applicationId":"'"$APP_ID"'",
    "sourceType":"git",
    "customGitUrl":"https://github.com/user/my-saas.git",
    "customGitBranch":"main"
  }'
fi

# 7. Set buildType (all 7 fields required in v0.28+)
bash scripts/dokploy-api.sh main POST application.saveBuildType '{
  "applicationId":"'"$APP_ID"'",
  "buildType":"nixpacks",
  "dockerfile":"Dockerfile",
  "dockerContextPath":"",
  "dockerBuildStage":"",
  "herokuVersion":"24",
  "railpackVersion":"0.15.4"
}'

# 8. Set env (all 5 fields required in v0.28+)
bash scripts/dokploy-api.sh main POST application.saveEnvironment '{
  "applicationId":"'"$APP_ID"'",
  "env":"DATABASE_URL='"$DB_URL"'\nNODE_ENV=production",
  "buildArgs":"",
  "buildSecrets":"",
  "createEnvFile":true
}'

# 9. Create the DNS record (WITHOUT proxy for Let's Encrypt!)
bash scripts/cloudflare-dns.sh create app.example.com "$SERVER_IP" false

# 10. Wait for DNS propagation
sleep 30

# 11. Add the domain with SSL
bash scripts/dokploy-api.sh main POST domain.create '{
  "applicationId":"'"$APP_ID"'",
  "host":"app.example.com",
  "port":3000,
  "https":true,
  "path":"/",
  "certificateType":"letsencrypt"
}'

# 12. Deploy
# v0.29+ (G-018): title + description are REQUIRED strings (not null). Empty desc OK.
bash scripts/dokploy-api.sh main POST application.deploy '{"applicationId":"'"$APP_ID"'","title":"Manual deploy","description":""}'
```

### Create a Compose project with raw YAML

```bash
# 1. Create the project
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-compose-app"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Create the compose project
COMPOSE=$(bash scripts/dokploy-api.sh main POST compose.create '{
  "name":"my-compose-app",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
COMPOSE_ID=$(echo "$COMPOSE" | jq -r '.composeId')

# 3. Upload raw YAML
bash scripts/dokploy-api.sh main POST compose.update '{
  "composeId":"'"$COMPOSE_ID"'",
  "sourceType":"raw",
  "composePath":"docker-compose.yml",
  "composeFile":"services:\n  app:\n    image: my-app:latest\n    ports:\n      - '\''3000:3000'\''\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}'

# 4. Deploy
bash scripts/dokploy-api.sh main POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

### Enable auto-deploy (GitHub App)

```bash
# Just enable the flag — GitHub App handles the rest automatically
bash scripts/dokploy-api.sh main POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "autoDeploy":true
}'
# No webhook setup needed when using GitHub App
```
