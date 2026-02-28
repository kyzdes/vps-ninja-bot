# Deploy Guide — Деплой проекта из GitHub

Этот гайд вызывается при команде `/vps deploy <github-url> [--domain <domain>] [--server <name>] [--branch <branch>]`.

Цель: Задеплоить проект из GitHub-репозитория на VPS с автоматическим определением стека, настройкой env-переменных, DNS и SSL.

---

## Парсинг аргументов

Из `$ARGUMENTS` извлеки:
- `$1` — GitHub URL (например: `github.com/user/repo` или `https://github.com/user/repo`)
- `--domain <domain>` — полный домен (например: `app.example.com`)
- `--server <name>` — имя сервера из конфига (по умолчанию: из `defaults.server`)
- `--branch <branch>` — ветка репозитория (по умолчанию: `main`, затем fallback на `master`)

Нормализуй GitHub URL:
```
github.com/user/repo → https://github.com/user/repo
https://github.com/user/repo → https://github.com/user/repo
```

---

## ФАЗА 1: Анализ проекта

Цель: Определить стек, порт, env-переменные, зависимости от БД — без участия пользователя.

### 1.1 Проверка доступности репозитория

Перед клонированием проверь, приватный ли репозиторий:

```bash
# Проверить доступность через git ls-remote
git ls-remote --exit-code "$GITHUB_URL" >/dev/null 2>&1
```

Если команда вернула ошибку → репо приватный или не существует. См. секцию "Приватные репозитории" ниже.

### 1.2 Клонирование репозитория

Создай временную директорию и клонируй репо:

```bash
TEMP_DIR="/tmp/vps-ninja-$(date +%s)"
git clone --depth 1 --branch <branch> <github-url> "$TEMP_DIR"
```

Если ветка не указана, попробуй сначала `main`, потом `master`:
```bash
git clone --depth 1 --branch main <url> "$TEMP_DIR" 2>/dev/null ||
git clone --depth 1 --branch master <url> "$TEMP_DIR"
```

Если обе попытки провалились → спроси пользователя: "Какую ветку деплоить?"

### 1.3 Определение стека

Прочитай файл `references/stack-detection.md` и примени правила оттуда.

Вкратце (приоритет сверху вниз):

```bash
# Проверь наличие файлов с помощью Glob и Read
if docker-compose.yml exists → STACK=docker-compose, BUILD_TYPE=compose
elif Dockerfile exists → STACK=docker, BUILD_TYPE=dockerfile
elif package.json exists → determine Node.js framework
elif requirements.txt or pyproject.toml exists → determine Python framework
elif go.mod exists → STACK=go, BUILD_TYPE=nixpacks
elif Cargo.toml exists → STACK=rust, BUILD_TYPE=nixpacks
elif Gemfile exists → STACK=ruby, BUILD_TYPE=nixpacks
elif pom.xml or build.gradle exists → STACK=java, BUILD_TYPE=nixpacks
else → STACK=unknown, ask user
```

> **Примечание:** Если есть И Dockerfile, И docker-compose.yml — см. stack-detection.md для логики выбора. Спроси пользователя.

**Для Node.js проектов** (если есть `package.json`):
```bash
# Read package.json
if dependencies has "next" → FRAMEWORK=Next.js, PORT=3000
elif dependencies has "nuxt" → FRAMEWORK=Nuxt, PORT=3000
elif dependencies has "@nestjs/core" → FRAMEWORK=NestJS, PORT=3000
elif dependencies has "express" → FRAMEWORK=Express, PORT=3000 (или из кода)
elif devDependencies has "vite" → FRAMEWORK=Vite SPA, BUILD_TYPE=static, PORT=80
else → FRAMEWORK=Node.js generic
```

**Для Python проектов:**
```bash
if requirements.txt has "django" → FRAMEWORK=Django, PORT=8000
elif requirements.txt has "fastapi" → FRAMEWORK=FastAPI, PORT=8000
elif requirements.txt has "flask" → FRAMEWORK=Flask, PORT=5000
```

### 1.4 Определение порта

Приоритет:

1. **Dockerfile** — если есть `EXPOSE <port>`:
   ```bash
   grep -E '^EXPOSE' "$TEMP_DIR/Dockerfile" | awk '{print $2}'
   ```

2. **Код приложения** — поиск `.listen(PORT)`, `.listen(3000)`, и т.д.:
   ```bash
   grep -rE '\.listen\(' "$TEMP_DIR" | head -5
   # Распарси и извлеки порт
   ```

3. **Конфиг фреймворка**:
   - Next.js: `package.json` scripts → `-p <port>` или env `PORT`
   - FastAPI/Django: settings.py → `PORT=` или `0.0.0.0:8000`
   - Go: main.go → `:8080` или `PORT`

4. **По умолчанию** для стека (см. stack-detection.md)

Если не удалось определить → PORT=null, спросишь пользователя позже.

### 1.5 Определение env-переменных

Найди все env-переменные, которые ожидает приложение:

**Источники:**

1. **.env.example / .env.template / .env.sample**:
   ```bash
   if .env.example exists:
     cat .env.example | grep -v '^#' | grep '=' | cut -d'=' -f1
   ```

2. **Код** (поиск `process.env.*`, `os.environ`, `os.Getenv`):
   ```bash
   # JavaScript/TypeScript
   grep -rE 'process\.env\.\w+' "$TEMP_DIR" --include="*.js" --include="*.ts" | \
     sed -E 's/.*process\.env\.([A-Z_0-9]+).*/\1/' | sort -u

   # Python
   grep -rE 'os\.(environ|getenv)\(["\'](\w+)["\']' "$TEMP_DIR" --include="*.py" | \
     sed -E 's/.*["'\''"](\w+)["'\''"].*/\1/' | sort -u

   # Go
   grep -rE 'os\.Getenv\("(\w+)"\)' "$TEMP_DIR" --include="*.go" | \
     sed -E 's/.*"(\w+)".*/\1/' | sort -u
   ```

3. **Prisma schema** → `DATABASE_URL`:
   ```bash
   if prisma/schema.prisma exists:
     ENV_VARS += DATABASE_URL
   ```

4. **README.md** — секция "Environment Variables":
   ```bash
   grep -A 20 -i 'environment' README.md
   ```

**Классификация переменных:**

Разбей найденные переменные на категории:
- **Секреты** (нужно спросить у пользователя): API keys, tokens, passwords, secrets
  - Паттерны: `*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD`, `*_API_KEY`
- **Автоматические** (можно установить автоматически):
  - `DATABASE_URL` → если создаём БД
  - `NEXTAUTH_URL`, `APP_URL`, `BASE_URL` → домен приложения
  - `NODE_ENV=production`, `RAILS_ENV=production`
- **Опциональные** (есть значения по умолчанию в .env.example)

### 1.6 Определение зависимостей от БД

**Признаки зависимости от PostgreSQL:**
- `package.json` dependencies: `pg`, `prisma`, `drizzle-orm`, `typeorm`
- `requirements.txt`: `psycopg2`, `asyncpg`
- Prisma schema: `datasource db { provider = "postgresql" }`

**Признаки зависимости от MySQL:**
- `package.json` dependencies: `mysql2`, `sequelize` (с MySQL dialect)
- `requirements.txt`: `mysqlclient`, `pymysql`

**Признаки зависимости от MongoDB:**
- `package.json` dependencies: `mongoose`, `mongodb`
- `requirements.txt`: `pymongo`, `mongoengine`

**Признаки зависимости от Redis:**
- `package.json` dependencies: `redis`, `ioredis`
- `requirements.txt`: `redis`

### 1.7 Результат анализа

Собери всю информацию в структуру:

```json
{
  "stack": "Next.js",
  "build_type": "nixpacks",
  "port": 3000,
  "branch": "main",
  "env_vars": {
    "secrets": ["NEXTAUTH_SECRET", "OPENAI_API_KEY"],
    "auto": ["DATABASE_URL", "NEXTAUTH_URL"],
    "optional": ["LOG_LEVEL"]
  },
  "dependencies": {
    "database": ["postgres"]
  }
}
```

Покажи пользователю:

```
Анализ репозитория github.com/user/repo завершён:

Обнаружен стек:
  Framework: Next.js 14
  Runtime: Node.js (определён автоматически)
  Порт: 3000
  Тип билда: Nixpacks

Env-переменные:
  Секреты (нужны значения):
    - NEXTAUTH_SECRET
    - OPENAI_API_KEY
  Автоматические (установлю сам):
    - DATABASE_URL → подключение к БД
    - NEXTAUTH_URL → https://<domain>

Зависимости:
  - PostgreSQL (обнаружен Prisma)
```

---

## ФАЗА 2: Уточнение

Теперь задай вопросы пользователю.

### 2.1 Спросить секреты

Для каждой секретной env-переменной:
```
Укажи значение для NEXTAUTH_SECRET:
```

Дождись ответа. Сохрани в переменную.

### 2.2 Спросить домен (если не передан)

Если `--domain` не указан:
```
На каком домене деплоить приложение?
Например: app.example.com
```

Если пользователь не хочет домен → предложи traefik.me (бесплатный wildcard DNS):
```
Можно использовать бесплатный домен: <random-id>.traefik.me (без SSL)
Или укажи свой домен.
```

### 2.3 Спросить про БД (если обнаружены зависимости)

Если обнаружена зависимость от PostgreSQL:
```
Обнаружена зависимость от PostgreSQL.

Варианты:
  1. Создать новую БД на сервере (рекомендуется)
  2. Использовать существующую БД (укажи DATABASE_URL)
  3. Пропустить (приложение может не работать)

Выбери вариант (1/2/3):
```

Если выбрал 1 → создашь БД в фазе 3.
Если выбрал 2 → попроси ввести `DATABASE_URL`.
Если выбрал 3 → не создавай БД, не устанавливай `DATABASE_URL`.

---

## ФАЗА 3: Деплой

Теперь у тебя есть вся информация. Выполни деплой через Dokploy API.

> **Критически важно (v0.27+):** Все вызовы `*.create` требуют `environmentId`. Получай его из ответа `project.create`.

### 3.1 Создать проект в Dokploy

Имя проекта = имя репозитория (из GitHub URL):
```bash
PROJECT_NAME=$(echo "$GITHUB_URL" | sed -E 's|.*/([^/]+)(\.git)?$|\1|')
```

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST project.create '{
  "name": "'"$PROJECT_NAME"'",
  "description": "Auto-deployed from '"$GITHUB_URL"'"
}')

# v0.27+: ответ вложенный
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')
```

Если ошибка → покажи и останови.

### 3.2 Создать БД (если нужна)

Если пользователь выбрал "Создать новую БД":

```bash
DB_PASSWORD=$(openssl rand -base64 16)

RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST postgres.create '{
  "name": "'"$PROJECT_NAME-db"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'",
  "databasePassword": "'"$DB_PASSWORD"'",
  "databaseUser": "'"$PROJECT_NAME"'",
  "databaseName": "'"$PROJECT_NAME"'"
}')

POSTGRES_ID=$(echo "$RESPONSE" | jq -r '.postgresId')
```

Деплой БД:
```bash
bash scripts/dokploy-api.sh "$SERVER" POST postgres.deploy '{
  "postgresId": "'"$POSTGRES_ID"'"
}'
```

Получи connection string:
```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" GET "postgres.one?postgresId=$POSTGRES_ID")
INTERNAL_DB_URL=$(echo "$RESPONSE" | jq -r '.internalDatabaseUrl')
# Формат: postgresql://<user>:<password>@<service-name>:5432/<dbname>
```

Добавь `DATABASE_URL` в auto env-vars:
```bash
ENV_AUTO["DATABASE_URL"]="$INTERNAL_DB_URL"
```

Аналогично для Redis (если нужен):
```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST redis.create '{
  "name": "'"$PROJECT_NAME-redis"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'",
  "databasePassword": "'"$(openssl rand -base64 16)"'"
}')
REDIS_ID=$(echo "$RESPONSE" | jq -r '.redisId')

bash scripts/dokploy-api.sh "$SERVER" POST redis.deploy '{"redisId":"'"$REDIS_ID"'"}'
```

### 3.3 Создать приложение в Dokploy

**Для обычных проектов (не docker-compose):**

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST application.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'"
}')

APP_ID=$(echo "$RESPONSE" | jq -r '.applicationId')
```

**Для docker-compose проектов (из GitHub):**

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST compose.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'"
}')

COMPOSE_ID=$(echo "$RESPONSE" | jq -r '.composeId')
```

### 3.4 Настроить Git-репозиторий

```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.update '{
  "applicationId": "'"$APP_ID"'",
  "sourceType": "github",
  "repository": "'"$GITHUB_URL"'",
  "branch": "'"$BRANCH"'",
  "autoDeploy": false
}'
```

### 3.5 Установить тип билда

```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.saveBuildType '{
  "applicationId": "'"$APP_ID"'",
  "buildType": "'"$BUILD_TYPE"'",
  "dockerContextPath": "",
  "dockerBuildStage": ""
}'
```

> **Обязательно (v0.27+):** Поля `dockerContextPath` и `dockerBuildStage` обязательны. Для не-Docker билдов передавай пустые строки `""`.

Где `$BUILD_TYPE` — один из: `nixpacks`, `dockerfile`, `railpack`, `heroku_buildpacks`, `paketo_buildpacks`, `static`.

### 3.6 Установить env-переменные

Собери все env-переменные в строку формата:
```
KEY1=value1
KEY2=value2
DATABASE_URL=postgresql://...
```

```bash
ENV_STRING=""
for key in "${!ENV_SECRETS[@]}"; do
  ENV_STRING+="$key=${ENV_SECRETS[$key]}\n"
done
for key in "${!ENV_AUTO[@]}"; do
  ENV_STRING+="$key=${ENV_AUTO[$key]}\n"
done

bash scripts/dokploy-api.sh "$SERVER" POST application.saveEnvironment '{
  "applicationId": "'"$APP_ID"'",
  "env": "'"$(echo -e "$ENV_STRING")"'"
}'
```

### 3.7 Создать DNS-запись в CloudFlare (если указан домен)

> **ВАЖНО: DNS должен быть настроен ДО добавления домена в Dokploy!**
> Let's Encrypt ACME HTTP challenge требует, чтобы домен уже указывал на сервер.
> Правильный порядок: DNS → подождать → Domain в Dokploy → Deploy.

Если пользователь указал домен:

```bash
SERVER_IP=$(jq -r ".servers.\"$SERVER\".host" config/servers.json)

# Создать DNS без CloudFlare proxy (для Let's Encrypt HTTP challenge)
bash scripts/cloudflare-dns.sh create "$DOMAIN" "$SERVER_IP" --no-proxy
```

> Для Let's Encrypt используй `--no-proxy` (proxied=false), т.к. CloudFlare proxy перехватывает HTTP challenge и сертификат не выпустится. После успешного выпуска сертификата proxy можно включить обратно.

Если ошибка (например, токен не настроен) → предупреди, но продолжи (DNS можно настроить позже вручную).

**Подождать DNS propagation:**
```bash
echo "Ожидание DNS propagation (~30 секунд)..."
sleep 30

# Проверить что DNS указывает на наш IP
RESOLVED_IP=$(dig +short "$DOMAIN" @1.1.1.1 | tail -1)
if [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
  echo "DNS ещё не propagated ($RESOLVED_IP vs $SERVER_IP). Подождём ещё..."
  sleep 30
fi
```

### 3.8 Добавить домен в Dokploy

```bash
bash scripts/dokploy-api.sh "$SERVER" POST domain.create '{
  "applicationId": "'"$APP_ID"'",
  "host": "'"$DOMAIN"'",
  "port": '"$PORT"',
  "https": true,
  "path": "/",
  "certificateType": "letsencrypt"
}'
```

### 3.9 Запустить деплой

```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.deploy '{
  "applicationId": "'"$APP_ID"'"
}'
```

Ответ содержит `deploymentId`.

### 3.10 Мониторинг деплоя

Периодически опрашивай статус деплоя:

```bash
while true; do
  RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" GET "deployment.all?applicationId=$APP_ID")
  STATUS=$(echo "$RESPONSE" | jq -r '.[0].status')

  if [ "$STATUS" = "done" ]; then
    echo "Билд завершён успешно"
    break
  elif [ "$STATUS" = "error" ]; then
    echo "Билд упал. Логи:"
    DEPLOYMENT_ID=$(echo "$RESPONSE" | jq -r '.[0].deploymentId')
    bash scripts/dokploy-api.sh "$SERVER" GET "deployment.logsByDeployment?deploymentId=$DEPLOYMENT_ID" | tail -50
    exit 1
  else
    echo "  Статус: $STATUS..."
    sleep 5
  fi
done
```

### 3.11 Проверить доступность приложения

Если есть домен:

```bash
bash scripts/wait-ready.sh "https://$DOMAIN" 120 10
```

Если успешно:
```
Приложение доступно: https://$DOMAIN
```

Если timeout:
```
Приложение не отвечает. Проверь логи: /vps logs $PROJECT_NAME
```

### 3.12 Enable auto-deploy

After successful deploy, enable auto-deploy via the API flag (GitHub App handles the actual webhook internally):

```bash
bash scripts/dokploy-api.sh "$SERVER" POST application.update '{
  "applicationId":"'"$APP_ID"'",
  "autoDeploy":true
}'
```

> **Do NOT suggest webhook setup, refresh tokens, or GitHub Actions.** The GitHub App installed in Dokploy handles auto-deploy natively. See `references/github-app-autodeploy.md`.

### 3.13 Final report

```
Deploy complete!

Project: $PROJECT_NAME
URL: https://$DOMAIN
Server: $SERVER
Status: Running

Created resources:
  - Application: $PROJECT_NAME ($BUILD_TYPE)
  - Database: PostgreSQL ($PROJECT_NAME-db)
  - DNS record: $DOMAIN -> $SERVER_IP (CloudFlare, proxy OFF)
  - SSL certificate: Let's Encrypt (automatic)

Auto-deploy: Active via GitHub App
  Push to `$BRANCH` to trigger a new deployment automatically.
  No webhooks or GitHub Actions needed.

Next steps:
  - Check app: https://$DOMAIN
  - Logs: /vps logs $PROJECT_NAME
  - Enable CloudFlare proxy: cloudflare-dns.sh create $DOMAIN $SERVER_IP true
  - Manual redeploy: /vps logs $PROJECT_NAME (or push to $BRANCH)
```

---

## Приватные репозитории

Если `git ls-remote` или `git clone` не удаётся (репо приватный):

### Вариант A (рекомендуемый): GitHub App интеграция в Dokploy

Это лучший вариант — автодеплой работает из коробки, не нужны токены.

```
Репозиторий приватный. Рекомендуется настроить GitHub App интеграцию в Dokploy:

1. Открой Dokploy UI → Settings → Server → GitHub
2. Нажми "Install GitHub App"
3. Выбери организацию/аккаунт и репозитории
4. После установки приватные репо будут доступны напрямую
```

После настройки GitHub App:
- `sourceType: "github"` работает с приватными репо
- Автодеплой через GitHub App webhooks (не нужен отдельный webhook)
- Для выбора репо используй owner/repo/branch прямо в Dokploy

### Вариант B: GitHub Personal Access Token (Classic)

Когда GitHub App невозможна (нет прав на установку):

```
Для доступа к приватному репозиторию нужен GitHub Personal Access Token:

1. Перейди на github.com/settings/tokens
2. "Generate new token (classic)"
3. Установи scope: repo (Full control of private repositories)
4. Скопируй токен и введи его сюда
```

После получения токена:
```bash
# Клонировать для анализа
git clone --depth 1 "https://$GITHUB_PAT@github.com/$OWNER/$REPO.git" "$TEMP_DIR"

# Настроить в Dokploy через customGitUrl
bash scripts/dokploy-api.sh "$SERVER" POST application.update '{
  "applicationId": "'"$APP_ID"'",
  "sourceType": "github",
  "customGitUrl": "https://'"$GITHUB_PAT"'@github.com/'"$OWNER"'/'"$REPO"'.git",
  "branch": "'"$BRANCH"'"
}'
```

> **Примечание:** Токен сохраняется в Dokploy. Ротация — вручную. При истечении токена деплой перестанет работать.

### Вариант C (fallback): Локальная сборка + Docker Compose raw

Когда ни GitHub App, ни PAT невозможны (корпоративные ограничения, одноразовый деплой):

```bash
# 1. Клонируй локально (у пользователя уже есть доступ)
git clone "$GITHUB_URL" "$TEMP_DIR"

# 2. Собери Docker-образ локально
cd "$TEMP_DIR"
docker build -t "$PROJECT_NAME:latest" .

# 3. Сохрани образ в файл
docker save "$PROJECT_NAME:latest" > "/tmp/$PROJECT_NAME.tar"

# 4. Загрузи на сервер
scp "/tmp/$PROJECT_NAME.tar" root@$SERVER_IP:/tmp/

# 5. Загрузи образ в Docker на сервере
bash scripts/ssh-exec.sh "$SERVER" "docker load < /tmp/$PROJECT_NAME.tar && rm /tmp/$PROJECT_NAME.tar"

# 6. Создай Compose-проект с raw YAML (см. секцию "Docker Compose (raw)")
```

---

## Docker Compose (raw)

### Когда использовать

- Приватные репо без GitHub App / PAT (Вариант C выше)
- Локально собранные Docker-образы
- Сложные multi-container приложения
- Кастомные конфигурации, не подходящие для стандартного деплоя

### Процесс деплоя

```bash
# 1. Создать проект
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST project.create '{"name":"'"$PROJECT_NAME"'"}')
PROJECT_ID=$(echo "$RESPONSE" | jq -r '.project.projectId // .projectId')
ENVIRONMENT_ID=$(echo "$RESPONSE" | jq -r '.environment.environmentId // empty')

# 2. Создать compose-проект
COMPOSE=$(bash scripts/dokploy-api.sh "$SERVER" POST compose.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "environmentId": "'"$ENVIRONMENT_ID"'"
}')
COMPOSE_ID=$(echo "$COMPOSE" | jq -r '.composeId')

# 3. Загрузить raw YAML
COMPOSE_YAML=$(cat <<'YAML'
version: '3.8'
services:
  app:
    image: my-app:latest
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
    networks:
      - dokploy-network
networks:
  dokploy-network:
    external: true
YAML
)

# Экранируй YAML для JSON
COMPOSE_YAML_ESCAPED=$(echo "$COMPOSE_YAML" | jq -Rs .)

bash scripts/dokploy-api.sh "$SERVER" POST compose.update '{
  "composeId": "'"$COMPOSE_ID"'",
  "sourceType": "raw",
  "composePath": "docker-compose.yml",
  "customCompose": '"$COMPOSE_YAML_ESCAPED"'
}'

# 4. Деплой
bash scripts/dokploy-api.sh "$SERVER" POST compose.deploy '{"composeId":"'"$COMPOSE_ID"'"}'
```

### Webhook для Compose

```bash
# Получить refreshToken из compose
COMPOSE_INFO=$(bash scripts/dokploy-api.sh "$SERVER" GET "compose.one?composeId=$COMPOSE_ID")
REFRESH_TOKEN=$(echo "$COMPOSE_INFO" | jq -r '.refreshToken')

# Webhook URL для compose
echo "Webhook: $DOKPLOY_URL/api/deploy/compose/$REFRESH_TOKEN"
```

---

## Обработка ошибок

### Build failed

Если деплой завершился со статусом `error`:

1. Получи логи:
   ```bash
   bash scripts/dokploy-api.sh "$SERVER" GET "deployment.logsByDeployment?deploymentId=$DEPLOYMENT_ID"
   ```

2. Проанализируй последние 50 строк

3. Типичные проблемы и решения:

| Ошибка в логах | Причина | Решение |
|:---------------|:--------|:--------|
| `npm ERR! 404` | Приватный пакет в package.json | Удали или сделай репо публичным |
| `Error: Cannot find module` | Зависимость не установлена | Проверь package.json, добавь в dependencies |
| `ECONNREFUSED :5432` | БД недоступна | Проверь `DATABASE_URL`, убедись что БД запущена |
| `Permission denied` | Неправильные права в Dockerfile | Проверь USER в Dockerfile |
| `Out of memory` | Не хватает RAM при билде | Создай swap или билди локально, пуши image |
| `Port already in use` | Конфликт портов | Измени порт в настройках приложения |
| `fatal: could not read from remote repository` | Приватный репозиторий | См. секцию "Приватные репозитории" |

4. Покажи пользователю ошибку и предложи решение

### DNS не резолвится

Если CloudFlare API вернул ошибку:

```
Не удалось создать DNS-запись в CloudFlare.
Причина: <error message>

Варианты:
  1. Настрой CloudFlare токен: /vps config cloudflare <token>
  2. Создай A-запись вручную: $DOMAIN → $SERVER_IP
  3. Продолжить без домена (доступ по IP:порт)
```

### Приложение не отвечает

Если `wait-ready.sh` вернул timeout:

1. Проверь, запущено ли приложение:
   ```bash
   bash scripts/ssh-exec.sh "$SERVER" "docker service ps $PROJECT_NAME"
   ```

2. Проверь логи runtime:
   ```bash
   bash scripts/ssh-exec.sh "$SERVER" "docker service logs $PROJECT_NAME --tail 50"
   ```

3. Возможные причины:
   - Приложение крашится при старте → env-переменные неверные
   - Приложение слушает неправильный порт → проверь PORT в env
   - Traefik не может достучаться → проверь `dokploy-network`

---

## Troubleshooting SSL / Let's Encrypt

Если SSL-сертификат не выпустился (сайт недоступен по HTTPS или показывает ошибку сертификата):

### Диагностика

```bash
# 1. Проверить DNS — должен возвращать IP сервера
dig "$DOMAIN" +short @1.1.1.1

# 2. Проверить что порты 80 и 443 открыты на сервере
bash scripts/ssh-exec.sh "$SERVER" "ufw status | grep -E '80|443'"

# 3. Проверить что CloudFlare proxy ВЫКЛЮЧЕН (для HTTP challenge)
bash scripts/cloudflare-dns.sh get "$DOMAIN"
# proxied должен быть false
```

### Решение

```bash
# 1. Убедиться что DNS без proxy
bash scripts/cloudflare-dns.sh create "$DOMAIN" "$SERVER_IP" false

# 2. Подождать DNS propagation
sleep 30

# 3. Рестарт Traefik для повторной попытки ACME challenge
bash scripts/ssh-exec.sh "$SERVER" "docker restart dokploy-traefik"

# 4. Подождать выпуск сертификата (до 60 секунд)
sleep 60

# 5. Проверить HTTPS
curl -sI "https://$DOMAIN" | head -5
```

### Если всё ещё не работает

```bash
# Проверить логи Traefik
bash scripts/ssh-exec.sh "$SERVER" "docker logs dokploy-traefik --tail 50 2>&1 | grep -i 'acme\|cert\|error'"
```

Типичные проблемы:
- **"acme: error 403"** → CloudFlare proxy мешает. Выключи proxy, подожди 5 мин, рестартни Traefik
- **"DNS problem: NXDOMAIN"** → DNS запись не существует или не propagated. Проверь запись в CloudFlare
- **"connection refused"** → Порт 80 закрыт. Проверь UFW: `ufw allow 80/tcp`
- **"too many certificates"** → Rate limit Let's Encrypt. Подожди 1 час и попробуй снова

### После успешного выпуска сертификата

Можно включить CloudFlare proxy обратно для CDN и DDoS-защиты:
```bash
bash scripts/cloudflare-dns.sh create "$DOMAIN" "$SERVER_IP" true
```

---

## Специальные случаи

### Docker Compose проекты (из GitHub)

Если обнаружен `docker-compose.yml` и используется GitHub:

1. Проверь, что все сервисы подключены к `dokploy-network`:
   ```yaml
   networks:
     dokploy-network:
       external: true
   ```

2. Используй `compose.create` вместо `application.create`

3. Для настройки доменов — либо через Dokploy UI, либо добавь Traefik labels в compose:
   ```yaml
   labels:
     - "traefik.enable=true"
     - "traefik.http.routers.app.rule=Host(`app.example.com`)"
   ```

### Monorepo

Если в репо несколько приложений:

1. Спроси пользователя: "Какое приложение деплоить?"
2. Используй настройку `buildPath` в Dokploy API:
   ```json
   {
     "applicationId": "...",
     "buildPath": "/packages/frontend"
   }
   ```
