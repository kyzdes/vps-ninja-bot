# Dokploy API Reference

Справочник основных Dokploy REST API endpoints, используемых в VPS Ninja.

Полная документация: https://docs.dokploy.com/docs/api

---

## Аутентификация

Все запросы требуют HTTP-заголовок:
```
x-api-key: <your-api-key>
```

API-ключ генерируется в Dokploy UI: Settings → Profile → API/CLI → Generate API Key

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
  "description": "Project description" // опционально
}
```

**Response:**
```json
{
  "projectId": "abc123",
  "name": "my-project",
  "description": "...",
  "createdAt": "2026-02-17T..."
}
```

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

**Request:**
```json
{
  "name": "my-app",
  "projectId": "abc123",
  "applicationStatus": "idle" // idle | running | stopped
}
```

**Response:**
```json
{
  "applicationId": "app1",
  "name": "my-app",
  "projectId": "abc123",
  "sourceType": null, // github | git | docker
  "buildType": null   // nixpacks | dockerfile | railpack | ...
}
```

### `POST application.update`

Обновить настройки приложения (Git-репозиторий, ветка, и т.д.).

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

### `POST application.saveBuildType`

Установить тип билда.

**Request:**
```json
{
  "applicationId": "app1",
  "buildType": "nixpacks" // nixpacks | dockerfile | railpack | heroku_buildpacks | paketo_buildpacks | static
}
```

Для `dockerfile` также можно указать:
```json
{
  "applicationId": "app1",
  "buildType": "dockerfile",
  "dockerfile": "Dockerfile",
  "dockerBuildArgs": "ARG1=value1\nARG2=value2"
}
```

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
  "domains": [...]
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

**Request:**
```json
{
  "name": "my-compose",
  "projectId": "abc123",
  "composeType": "github" // github | git | raw
}
```

**Response:**
```json
{
  "composeId": "comp1"
}
```

### `POST compose.update`

Обновить настройки compose-проекта.

**Request:**
```json
{
  "composeId": "comp1",
  "composeType": "github",
  "repository": "https://github.com/user/repo",
  "branch": "main",
  "composePath": "docker-compose.yml" // путь к файлу в репо
}
```

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
  "certificateType": "letsencrypt" // letsencrypt | none
}
```

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

**Request:**
```json
{
  "name": "my-db",
  "projectId": "abc123",
  "databaseName": "myapp",
  "databaseUser": "myapp",
  "databasePassword": "secure-password"
}
```

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
- `POST mysql.create`
- `POST mysql.deploy`
- `GET mysql.one`
- `DELETE mysql.remove`

---

## Databases — MariaDB

- `POST mariadb.create`
- `POST mariadb.deploy`
- `GET mariadb.one`
- `DELETE mariadb.remove`

---

## Databases — MongoDB

- `POST mongo.create`
- `POST mongo.deploy`
- `GET mongo.one`
- `DELETE mongo.remove`

---

## Databases — Redis

- `POST redis.create`
- `POST redis.deploy`
- `GET redis.one`
- `DELETE redis.remove`

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
    "status": "done", // running | done | error | cancelled
    "createdAt": "2026-02-17T...",
    "finishedAt": "2026-02-17T..."
  }
]
```

### `GET deployment.logsByDeployment`

Получить логи деплойа.

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
  "version": "v0.26.6"
}
```

---

## Примеры использования

### Создать проект и задеплоить Next.js приложение

```bash
# 1. Создать проект
PROJECT=$(bash scripts/dokploy-api.sh main POST project.create '{"name":"my-saas"}')
PROJECT_ID=$(echo "$PROJECT" | jq -r '.projectId')

# 2. Создать PostgreSQL
PG=$(bash scripts/dokploy-api.sh main POST postgres.create '{
  "name":"my-saas-db",
  "projectId":"'"$PROJECT_ID"'",
  "databasePassword":"secure123"
}')
PG_ID=$(echo "$PG" | jq -r '.postgresId')

# 3. Деплой PostgreSQL
bash scripts/dokploy-api.sh main POST postgres.deploy '{"postgresId":"'"$PG_ID"'"}'

# 4. Получить connection string
PG_INFO=$(bash scripts/dokploy-api.sh main GET "postgres.one?postgresId=$PG_ID")
DB_URL=$(echo "$PG_INFO" | jq -r '.internalDatabaseUrl')

# 5. Создать приложение
APP=$(bash scripts/dokploy-api.sh main POST application.create '{
  "name":"my-saas",
  "projectId":"'"$PROJECT_ID"'"
}')
APP_ID=$(echo "$APP" | jq -r '.applicationId')

# 6. Настроить Git
bash scripts/dokploy-api.sh main POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "sourceType":"github",
  "repository":"https://github.com/user/my-saas",
  "branch":"main"
}'

# 7. Установить buildType
bash scripts/dokploy-api.sh main POST application.saveBuildType '{
  "applicationId":"'"$APP_ID"'",
  "buildType":"nixpacks"
}'

# 8. Установить env
bash scripts/dokploy-api.sh main POST application.saveEnvironment '{
  "applicationId":"'"$APP_ID"'",
  "env":"DATABASE_URL='"$DB_URL"'\nNODE_ENV=production"
}'

# 9. Добавить домен
bash scripts/dokploy-api.sh main POST domain.create '{
  "applicationId":"'"$APP_ID"'",
  "host":"app.example.com",
  "port":3000,
  "https":true,
  "certificateType":"letsencrypt"
}'

# 10. Деплой
bash scripts/dokploy-api.sh main POST application.deploy '{"applicationId":"'"$APP_ID"'"}'
```
