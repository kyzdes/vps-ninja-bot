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

### 1.1 Клонирование репозитория

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

### 1.2 Определение стека

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

### 1.3 Определение порта

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

### 1.4 Определение env-переменных

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

### 1.5 Определение зависимостей от БД

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

### 1.6 Результат анализа

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

PROJECT_ID=$(echo "$RESPONSE" | jq -r '.projectId')
```

Если ошибка → покажи и останови.

### 3.2 Создать БД (если нужна)

Если пользователь выбрал "Создать новую БД":

```bash
DB_PASSWORD=$(openssl rand -base64 16)

RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST postgres.create '{
  "name": "'"$PROJECT_NAME-db"'",
  "projectId": "'"$PROJECT_ID"'",
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

### 3.3 Создать приложение в Dokploy

**Для обычных проектов (не docker-compose):**

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST application.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "applicationStatus": "idle",
  "sourceType": "github"
}')

APP_ID=$(echo "$RESPONSE" | jq -r '.applicationId')
```

**Для docker-compose проектов:**

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER" POST compose.create '{
  "name": "'"$PROJECT_NAME"'",
  "projectId": "'"$PROJECT_ID"'",
  "composeType": "github"
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
  "buildType": "'"$BUILD_TYPE"'"
}'
```

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

Если пользователь указал домен:

```bash
SERVER_IP=$(jq -r ".servers.\"$SERVER\".host" config/servers.json)

bash scripts/cloudflare-dns.sh create "$DOMAIN" "$SERVER_IP" true
```

Если ошибка (например, токен не настроен) → предупреди, но продолжи (DNS можно настроить позже вручную).

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
    echo "✓ Билд завершён успешно"
    break
  elif [ "$STATUS" = "error" ]; then
    echo "✗ Билд упал. Логи:"
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
✓ Приложение доступно: https://$DOMAIN
```

Если timeout:
```
⚠️ Приложение не отвечает. Проверь логи: /vps logs $PROJECT_NAME
```

### 3.12 Итоговый отчёт

```
✅ Деплой завершён!

Проект: $PROJECT_NAME
URL: https://$DOMAIN
Сервер: $SERVER
Статус: Running

Созданные ресурсы:
  - Приложение: $PROJECT_NAME ($BUILD_TYPE)
  - База данных: PostgreSQL ($PROJECT_NAME-db)
  - DNS-запись: $DOMAIN → $SERVER_IP (CloudFlare Proxy)
  - SSL-сертификат: Let's Encrypt (автоматически)

Env-переменные:
  - DATABASE_URL: ***
  - NEXTAUTH_SECRET: ***
  - NEXTAUTH_URL: https://$DOMAIN

Следующие шаги:
  - Проверь приложение: https://$DOMAIN
  - Логи: /vps logs $PROJECT_NAME
  - Редеплой: /vps deploy $GITHUB_URL --domain $DOMAIN
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

4. Покажи пользователю ошибку и предложи решение

### DNS не резолвится

Если CloudFlare API вернул ошибку:

```
⚠️ Не удалось создать DNS-запись в CloudFlare.
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

## Специальные случаи

### Docker Compose проекты

Если обнаружен `docker-compose.yml`:

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

### Private репозитории

Если репо приватный:

1. Dokploy поддерживает GitHub App — попроси пользователя установить через UI
2. Или используй deploy key:
   ```bash
   # Сгенерируй SSH-ключ на сервере
   bash scripts/ssh-exec.sh "$SERVER" "ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ''"
   # Попроси пользователя добавить публичный ключ в GitHub Settings → Deploy keys
   ```
