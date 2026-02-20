# Dokploy API Reference

Справочник основных Dokploy REST API endpoints, используемых в VPS Ninja.

Полная документация: https://docs.dokploy.com/docs/api

> **Версия:** Актуально для Dokploy v0.27+. Более ранние версии могут иметь другие эндпоинты и форматы ответов.

---

## Аутентификация

Все запросы требуют HTTP-заголовок:
```
x-api-key: <your-api-key>
```

API-ключ генерируется в Dokploy UI: Settings → Profile → API/CLI → Generate API Key

> **Примечание:** В v0.27+ эндпоинт `auth.createUser` / `auth.createAdmin` удалён. Админ-аккаунт создаётся ТОЛЬКО через UI по адресу `http://IP:3000` при первом запуске.

---

## Base URL

```
http://<server-ip>:3000/api
```

Или с доменом:
```
https://panel.example.com/api
```

---

## Projects

### `POST project.create`

Создать новый проект (top-level контейнер для приложений и БД).

**Request:**
```json
{
  "name": "my-project",
  "description": "Project description"
}
```

**Response (v0.27+):**

> **Внимание:** Ответ вложенный — содержит `project` и `environment` объекты.

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

**Извлечение данных:**
```bash
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')
```

> `environmentId` нужен для создания приложений, БД и Compose-проектов в рамках данного проекта.

### `GET project.all`

Получить все проекты (со вложенными приложениями, БД, доменами).

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

### `DELETE project.remove`

Удалить проект (вместе со всеми вложенными ресурсами).

**Request:**
```json
{
  "projectId": "abc123"
}
```

---

## Applications

### `POST application.create`

Создать приложение в проекте.

**Request (v0.27+):**
```json
{
  "name": "my-app",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Обязательно:** `environmentId` — обязательное поле в v0.27+. Получается из ответа `project.create` (поле `environment.environmentId`) или из `project.all`.

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

Обновить настройки приложения (Git-репозиторий, ветка, autoDeploy и т.д.).

**Request:**
```json
{
  "applicationId": "app1",
  "sourceType": "github",
  "repository": "https://github.com/user/repo",
  "branch": "main",
  "autoDeploy": false
}
```

**Для приватных репозиториев через PAT:**
```json
{
  "applicationId": "app1",
  "sourceType": "github",
  "customGitUrl": "https://<github-pat>@github.com/user/repo.git",
  "branch": "main"
}
```

### `POST application.saveBuildType`

Установить тип билда.

**Request (v0.27+):**
```json
{
  "applicationId": "app1",
  "buildType": "nixpacks",
  "dockerContextPath": "",
  "dockerBuildStage": ""
}
```

> **Обязательно:** Поля `dockerContextPath` и `dockerBuildStage` обязательны даже для не-Docker build types. Передавай пустые строки `""`.

Для `dockerfile` можно указать реальные значения:
```json
{
  "applicationId": "app1",
  "buildType": "dockerfile",
  "dockerfile": "Dockerfile",
  "dockerContextPath": ".",
  "dockerBuildStage": "",
  "dockerBuildArgs": "ARG1=value1\nARG2=value2"
}
```

Допустимые `buildType`: `nixpacks`, `dockerfile`, `railpack`, `heroku_buildpacks`, `paketo_buildpacks`, `static`.

### `POST application.saveEnvironment`

Установить env-переменные.

**Request:**
```json
{
  "applicationId": "app1",
  "env": "DATABASE_URL=postgresql://...\nNODE_ENV=production\nSECRET_KEY=abc123"
}
```

Формат: ключ=значение, разделитель — `\n` (перевод строки).

### `POST application.deploy`

Запустить деплой приложения.

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

Остановить приложение.

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.start`

Запустить приложение (после остановки).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `POST application.redeploy`

Передеплоить приложение (rebuild + restart).

**Request:**
```json
{
  "applicationId": "app1"
}
```

### `GET application.one`

Получить информацию об одном приложении.

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

### `DELETE application.delete`

Удалить приложение.

**Request:**
```json
{
  "applicationId": "app1"
}
```

---

## Docker Compose

### `POST compose.create`

Создать compose-проект.

**Request (v0.27+):**
```json
{
  "name": "my-compose",
  "projectId": "abc123",
  "environmentId": "env456"
}
```

> **Обязательно:** `environmentId` — обязательное поле в v0.27+.

**Response:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.update`

Обновить настройки compose-проекта.

**Для GitHub-репозитория:**
```json
{
  "composeId": "comp1",
  "sourceType": "github",
  "repository": "https://github.com/user/repo",
  "branch": "main",
  "composePath": "docker-compose.yml"
}
```

**Для raw-режима (inline YAML):**
```json
{
  "composeId": "comp1",
  "sourceType": "raw",
  "composePath": "docker-compose.yml",
  "customCompose": "version: '3.8'\nservices:\n  app:\n    image: my-app:latest\n    ports:\n      - '3000:3000'\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}
```

> **Raw-режим** используется когда нет Git-репозитория: локально собранные образы, приватные репо без токена, или кастомные multi-container конфигурации.

### `POST compose.deploy`

Задеплоить compose-проект.

**Request:**
```json
{
  "composeId": "comp1"
}
```

### `DELETE compose.remove`

Удалить compose-проект.

**Request:**
```json
{
  "composeId": "comp1"
}
```

---

## Webhooks / Auto-deploy

### Включение автодеплоя

```json
POST application.update
{
  "applicationId": "app1",
  "autoDeploy": true
}
```

### Получение refresh-токена для вебхука

```
GET application.one?applicationId=app1
```

Извлечь `refreshToken` из ответа:
```bash
REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken')
```

### Webhook URL

Для приложений:
```
POST https://<dokploy-url>/api/deploy/{refreshToken}
```

Для compose-проектов:
```
POST https://<dokploy-url>/api/deploy/compose/{refreshToken}
```

### Настройка GitHub Webhook

1. В репозитории: Settings → Webhooks → Add webhook
2. Payload URL: `https://<dokploy-url>/api/deploy/<refreshToken>`
3. Content type: `application/json`
4. Events: Just the push event
5. Active: checked

### Альтернатива: GitHub App интеграция

Dokploy поддерживает нативную интеграцию с GitHub через GitHub App:

1. В Dokploy UI: Settings → Server → GitHub → Install GitHub App
2. После установки: приватные репо доступны через `sourceType: "github"`, автодеплой работает из коробки

---

## Domains

### `POST domain.create`

Добавить домен к приложению.

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

> **Важно:** DNS A-запись должна быть создана и propagated ДО вызова `domain.create` с `certificateType: "letsencrypt"`. Иначе ACME challenge провалится и сертификат не будет выпущен. См. порядок: DNS → Domain → Deploy.

**Response:**
```json
{
  "domainId": "dom1",
  "host": "app.example.com",
  "port": 3000,
  "https": true
}
```

### `DELETE domain.delete`

Удалить домен.

**Request:**
```json
{
  "domainId": "dom1"
}
```

---

## Databases — PostgreSQL

### `POST postgres.create`

Создать PostgreSQL базу данных.

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

> **Обязательно:** `environmentId` и `databasePassword` — обязательные поля в v0.27+.

**Response:**
```json
{
  "postgresId": "pg1",
  "name": "my-db"
}
```

### `POST postgres.deploy`

Запустить PostgreSQL (после создания или остановки).

**Request:**
```json
{
  "postgresId": "pg1"
}
```

### `GET postgres.one`

Получить информацию о PostgreSQL, включая connection strings.

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
  "externalDatabaseUrl": "postgresql://myapp:password@45.55.67.89:5432/myapp"
}
```

### `DELETE postgres.remove`

Удалить PostgreSQL.

**Request:**
```json
{
  "postgresId": "pg1"
}
```

---

## Databases — MySQL

Аналогично PostgreSQL, но endpoints:
- `POST mysql.create` (требует `environmentId`, `databasePassword`)
- `POST mysql.deploy`
- `GET mysql.one`
- `DELETE mysql.remove`

---

## Databases — MariaDB

- `POST mariadb.create` (требует `environmentId`, `databasePassword`)
- `POST mariadb.deploy`
- `GET mariadb.one`
- `DELETE mariadb.remove`

---

## Databases — MongoDB

- `POST mongo.create` (требует `environmentId`, `databasePassword`)
- `POST mongo.deploy`
- `GET mongo.one`
- `DELETE mongo.remove`

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

> **Обязательно:** `environmentId` и `databasePassword` — обязательные поля в v0.27+.

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

### `DELETE redis.remove`

**Request:**
```json
{
  "redisId": "redis1"
}
```

---

## Deployments

### `GET deployment.all`

Получить все деплойменты для приложения.

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

Получить логи деплоя.

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

Получить версию Dokploy.

**Response:**
```json
{
  "version": "v0.27.0"
}
```

---

## Примеры использования

### Создать проект и задеплоить Next.js приложение (v0.27+)

```bash
# 1. Создать проект (ответ вложенный!)
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-saas"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Создать PostgreSQL (требует environmentId и databasePassword)
PG=$(bash scripts/dokploy-api.sh main POST postgres.create '{
  "name":"my-saas-db",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'",
  "databasePassword":"'"$(openssl rand -base64 16)"'",
  "databaseUser":"mysaas",
  "databaseName":"mysaas"
}')
PG_ID=$(echo "$PG" | jq -r '.postgresId')

# 3. Деплой PostgreSQL
bash scripts/dokploy-api.sh main POST postgres.deploy '{"postgresId":"'"$PG_ID"'"}'

# 4. Получить connection string
PG_INFO=$(bash scripts/dokploy-api.sh main GET "postgres.one?postgresId=$PG_ID")
DB_URL=$(echo "$PG_INFO" | jq -r '.internalDatabaseUrl')

# 5. Создать приложение (требует environmentId)
APP=$(bash scripts/dokploy-api.sh main POST application.create '{
  "name":"my-saas",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
APP_ID=$(echo "$APP" | jq -r '.applicationId')

# 6. Настроить Git
bash scripts/dokploy-api.sh main POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "sourceType":"github",
  "repository":"https://github.com/user/my-saas",
  "branch":"main"
}'

# 7. Установить buildType (dockerContextPath и dockerBuildStage обязательны)
bash scripts/dokploy-api.sh main POST application.saveBuildType '{
  "applicationId":"'"$APP_ID"'",
  "buildType":"nixpacks",
  "dockerContextPath":"",
  "dockerBuildStage":""
}'

# 8. Установить env
bash scripts/dokploy-api.sh main POST application.saveEnvironment '{
  "applicationId":"'"$APP_ID"'",
  "env":"DATABASE_URL='"$DB_URL"'\nNODE_ENV=production"
}'

# 9. Создать DNS-запись (БЕЗ proxy для Let's Encrypt!)
bash scripts/cloudflare-dns.sh create app.example.com "$SERVER_IP" false

# 10. Подождать DNS propagation
sleep 30

# 11. Добавить домен с SSL
bash scripts/dokploy-api.sh main POST domain.create '{
  "applicationId":"'"$APP_ID"'",
  "host":"app.example.com",
  "port":3000,
  "https":true,
  "path":"/",
  "certificateType":"letsencrypt"
}'

# 12. Деплой
bash scripts/dokploy-api.sh main POST application.deploy '{"applicationId":"'"$APP_ID"'"}'
```

### Создать Compose-проект с raw YAML

```bash
# 1. Создать проект
RESPONSE=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-compose-app"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Создать compose-проект
COMPOSE=$(bash scripts/dokploy-api.sh main POST compose.create '{
  "name":"my-compose-app",
  "projectId":"'"$PROJECT_ID"'",
  "environmentId":"'"$ENVIRONMENT_ID"'"
}')
COMPOSE_ID=$(echo "$COMPOSE" | jq -r '.composeId')

# 3. Загрузить raw YAML
bash scripts/dokploy-api.sh main POST compose.update '{
  "composeId":"'"$COMPOSE_ID"'",
  "sourceType":"raw",
  "composePath":"docker-compose.yml",
  "customCompose":"version: '\''3.8'\''\nservices:\n  app:\n    image: my-app:latest\n    ports:\n      - '\''3000:3000'\''\n    networks:\n      - dokploy-network\nnetworks:\n  dokploy-network:\n    external: true"
}'

# 4. Деплой
bash scripts/dokploy-api.sh main POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

### Настроить автодеплой через webhook

```bash
# 1. Включить autoDeploy
bash scripts/dokploy-api.sh main POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "autoDeploy":true
}'

# 2. Получить refreshToken
APP_INFO=$(bash scripts/dokploy-api.sh main GET "application.one?applicationId=$APP_ID")
REFRESH_TOKEN=$(echo "$APP_INFO" | jq -r '.refreshToken')

# 3. Webhook URL для GitHub
echo "Webhook URL: https://<dokploy-url>/api/deploy/$REFRESH_TOKEN"
# Добавь этот URL в GitHub → Settings → Webhooks
```
