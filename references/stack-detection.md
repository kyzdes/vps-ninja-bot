# Stack Detection — Определение стека проекта

Правила для автоматического распознавания стека проекта из склонированного репозитория.

---

## Приоритет проверок

Проверяй в следующем порядке (сверху вниз — первое совпадение выигрывает):

1. `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` / `compose.yaml` → **Docker Compose** (но см. "Dockerfile + Compose конфликт" ниже)
2. `Dockerfile` → **Docker**
3. `package.json` → **Node.js** (определяй фреймворк внутри)
4. `requirements.txt` OR `pyproject.toml` OR `Pipfile` → **Python**
5. `go.mod` → **Go**
6. `Cargo.toml` → **Rust**
7. `Gemfile` → **Ruby**
8. `pom.xml` OR `build.gradle` OR `build.gradle.kts` → **Java**
9. `*.csproj` → **.NET / C#**
10. `composer.json` → **PHP**
11. Нет совпадений → **Unknown** (попроси пользователя указать)

### Dockerfile + Compose конфликт

Если в проекте есть **и** `docker-compose.yml`, **и** `Dockerfile`:

1. **Проанализируй compose-файл:** посчитай количество сервисов:
   ```bash
   # Количество сервисов в docker-compose.yml
   SERVICE_COUNT=$(grep -cE '^\s{2}\w+:' docker-compose.yml)
   # Или через yq/python если доступен
   ```

2. **Принятие решения:**

   - **Compose содержит >1 сервис** (multi-container приложение):
     Рекомендуй Compose. Спроси пользователя для подтверждения:
     ```
     Обнаружены docker-compose.yml (N сервисов) и Dockerfile.
     Рекомендую деплоить как Docker Compose (multi-container).

     Варианты:
       1. Docker Compose — задеплоить все сервисы (рекомендуется)
       2. Одиночный контейнер из Dockerfile
     ```

   - **Compose содержит 1 сервис:**
     Это может быть обёртка вокруг Dockerfile для удобства разработки. Спроси:
     ```
     Обнаружены docker-compose.yml (1 сервис) и Dockerfile.

     Варианты:
       1. Docker Compose — деплой через compose API
       2. Одиночный контейнер из Dockerfile (рекомендуется для простых приложений)
     ```

   - **Compose содержит только внешние сервисы** (образы без build, например только postgres/redis):
     Compose используется для инфраструктуры разработки. Деплой через Dockerfile:
     ```
     docker-compose.yml содержит только инфраструктурные сервисы (БД, кэш).
     Деплою приложение из Dockerfile, а БД создам через Dokploy.
     ```

3. **Определение типа compose-файла:**
   ```bash
   # Проверить: есть ли build директивы в compose
   HAS_BUILD=$(grep -c 'build:' docker-compose.yml || echo 0)

   # Проверить: есть ли только image директивы (без build)
   HAS_IMAGE_ONLY=$(grep -c 'image:' docker-compose.yml || echo 0)

   # Если есть build — приложение собирается из исходников
   # Если только image — используются готовые образы
   ```

---

## Таблица маркеров и стеков

| Маркерный файл | Стек | Build Type | Порт по умолчанию | Примечания |
|:---------------|:-----|:-----------|:------------------|:-----------|
| `docker-compose.yml` | Docker Compose | `compose` | из конфига | Используй Dokploy Compose API |
| `Dockerfile` | Docker | `dockerfile` | из EXPOSE | Используй Dokploy Application с buildType=dockerfile |
| `package.json` + `next.config.*` | Next.js | `nixpacks` | 3000 | Определяй версию из package.json |
| `package.json` + `nuxt.config.*` | Nuxt | `nixpacks` | 3000 | Nuxt 2 vs 3 — смотри dependencies |
| `package.json` + `nest-cli.json` | NestJS | `nixpacks` | 3000 | Backend framework |
| `package.json` + `angular.json` | Angular | `nixpacks` | 4200 → 80 | Production build статичный |
| `package.json` + `vite.config.*` | Vite SPA | `static` | 80 | Билдится в dist/, раздаётся через nginx |
| `package.json` + `express` dep | Express.js | `nixpacks` | 3000 | Определяй порт из кода |
| `package.json` + `@remix-run/*` | Remix | `nixpacks` | 3000 | |
| `package.json` + `gatsby` | Gatsby | `static` | 80 | Статичный сайт |
| `requirements.txt` + `django` | Django | `nixpacks` | 8000 | Проверь settings.py для порта |
| `requirements.txt` + `fastapi` | FastAPI | `nixpacks` | 8000 | Проверь main.py |
| `requirements.txt` + `flask` | Flask | `nixpacks` | 5000 | |
| `pyproject.toml` + `poetry` | Python (Poetry) | `nixpacks` | 8000 | Определяй фреймворк из dependencies |
| `go.mod` | Go | `nixpacks` | 8080 | Проверь main.go для порта |
| `Cargo.toml` | Rust | `nixpacks` | 8080 | |
| `Gemfile` + `rails` | Ruby on Rails | `nixpacks` | 3000 | |
| `Gemfile` + `sinatra` | Sinatra | `nixpacks` | 4567 | |
| `pom.xml` | Java (Maven) | `nixpacks` | 8080 | Spring Boot → проверь application.properties |
| `build.gradle` | Java (Gradle) | `nixpacks` | 8080 | |
| `*.csproj` | .NET | `nixpacks` | 5000 | ASP.NET Core |
| `composer.json` + `laravel` | Laravel | `nixpacks` | 8000 | |
| `composer.json` + `symfony` | Symfony | `nixpacks` | 8000 | |

---

## Определение порта приложения

### Приоритет источников

1. **Dockerfile EXPOSE**:
   ```bash
   grep -E '^EXPOSE' Dockerfile | head -1 | awk '{print $2}'
   ```

2. **Код приложения** — паттерны по языку:

   **JavaScript / TypeScript:**
   ```bash
   grep -rE '\.(listen|createServer)\(' --include="*.js" --include="*.ts" | \
     grep -oE '(process\.env\.PORT|[0-9]{4,5})' | head -1
   ```
   Примеры:
   - `app.listen(3000)` → 3000
   - `app.listen(process.env.PORT || 3000)` → 3000 (fallback)
   - `server.listen(8080)` → 8080

   **Python:**
   ```bash
   grep -rE 'uvicorn\.run|app\.run\(' --include="*.py" | \
     grep -oE 'port=[0-9]+' | cut -d'=' -f2 | head -1
   ```
   Примеры:
   - `uvicorn.run(app, port=8000)` → 8000
   - `app.run(host="0.0.0.0", port=5000)` → 5000

   **Go:**
   ```bash
   grep -rE 'ListenAndServe' --include="*.go" | \
     grep -oE ':[0-9]{4,5}' | tr -d ':' | head -1
   ```
   Пример:
   - `http.ListenAndServe(":8080", nil)` → 8080

   **Rust:**
   ```bash
   grep -rE '\.bind\(' --include="*.rs" | \
     grep -oE '[0-9]{4,5}' | head -1
   ```

3. **Конфиг фреймворка**:

   - **Next.js**: `package.json` → `scripts.dev` или `scripts.start`:
     ```json
     "scripts": {
       "dev": "next dev -p 3001"
     }
     ```
     → Извлеки порт после `-p`

   - **Vite**: `vite.config.ts` → `server.port`:
     ```ts
     export default defineConfig({
       server: { port: 5173 }
     })
     ```

   - **Django**: `settings.py` → нет порта (используй 8000 по умолчанию)

   - **Spring Boot**: `application.properties` или `application.yml`:
     ```properties
     server.port=8081
     ```

4. **По умолчанию** из таблицы выше (по стеку)

5. **Не удалось определить** → PORT=null, спроси пользователя

---

## Определение env-переменных

### Источники

#### 1. Файлы с примерами env-переменных

Поддерживаемые имена:
- `.env.example`
- `.env.template`
- `.env.sample`
- `.env.dist`
- `.env.local.example`

Парсинг:
```bash
cat .env.example | grep -v '^#' | grep -v '^$' | grep '=' | cut -d'=' -f1
```

Пример `.env.example`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/db
NEXTAUTH_SECRET=change-me
NEXTAUTH_URL=http://localhost:3000
LOG_LEVEL=info
```

→ Найдено: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `LOG_LEVEL`

Значения справа от `=`:
- Если `change-me`, `your-*`, `replace-*`, `<your-*>`, пусто → **секрет** (нужно спросить)
- Если конкретное значение (например `info`, `localhost`) → **опционально** (есть дефолт)

#### 2. Код приложения

**JavaScript / TypeScript:**
```bash
grep -rE 'process\.env\.\w+' --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" | \
  sed -E 's/.*process\.env\.([A-Z_0-9]+).*/\1/' | sort -u
```

**Python:**
```bash
grep -rE 'os\.(environ\.get|getenv)\(["\'](\w+)["\']' --include="*.py" | \
  sed -E 's/.*["\'\''"](\w+)["\'\''"].*/\1/' | sort -u
```

**Go:**
```bash
grep -rE 'os\.Getenv\("(\w+)"\)' --include="*.go" | \
  sed -E 's/.*"(\w+)".*/\1/' | sort -u
```

**Rust:**
```bash
grep -rE 'env::var\("(\w+)"\)' --include="*.rs" | \
  sed -E 's/.*"(\w+)".*/\1/' | sort -u
```

#### 3. Prisma / Drizzle / TypeORM

**Prisma schema** (`prisma/schema.prisma`):
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
→ Автоматически добавь `DATABASE_URL`

**Drizzle** (`drizzle.config.ts`):
```ts
export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
}
```
→ Автоматически добавь `DATABASE_URL`

**TypeORM** (`ormconfig.json` или `data-source.ts`):
```json
{
  "type": "postgres",
  "url": "process.env.DATABASE_URL"
}
```
→ Автоматически добавь `DATABASE_URL`

#### 4. README.md

Найди секцию "Environment Variables" или "Configuration":
```bash
grep -A 30 -i 'environment' README.md | grep -E '^[A-Z_]+='
```

### Классификация переменных

После сбора всех env-переменных, классифицируй их:

| Категория | Критерий | Действие |
|:----------|:---------|:---------|
| **Секреты** | Имя содержит `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `API_KEY`, `PRIVATE` | Спросить у пользователя |
| **Автоматические** | `DATABASE_URL`, `*_URL` (если создаём БД или домен) | Установить автоматически |
| **Автоматические** | `NODE_ENV`, `RAILS_ENV`, `ENVIRONMENT`, `ENV` | Установить `production` |
| **Автоматические** | `NEXTAUTH_URL`, `APP_URL`, `BASE_URL`, `PUBLIC_URL` | Установить домен приложения |
| **Опциональные** | Есть значение в .env.example (не секрет) | Использовать дефолт или спросить |

---

## Определение зависимостей от БД

### PostgreSQL

**Признаки:**
- `package.json` dependencies: `pg`, `postgres`, `prisma`, `drizzle-orm`, `typeorm`, `sequelize`
- `requirements.txt`: `psycopg2`, `psycopg2-binary`, `asyncpg`, `sqlalchemy` (если используется с PostgreSQL)
- `go.mod`: `github.com/lib/pq`, `gorm.io/driver/postgres`
- `Cargo.toml`: `tokio-postgres`, `diesel` (с feature `postgres`)
- Prisma schema: `provider = "postgresql"`

### MySQL

**Признаки:**
- `package.json` dependencies: `mysql`, `mysql2`
- `requirements.txt`: `mysqlclient`, `pymysql`, `aiomysql`
- `go.mod`: `github.com/go-sql-driver/mysql`, `gorm.io/driver/mysql`
- Prisma schema: `provider = "mysql"`

### MongoDB

**Признаки:**
- `package.json` dependencies: `mongodb`, `mongoose`
- `requirements.txt`: `pymongo`, `mongoengine`, `motor`
- `go.mod`: `go.mongodb.org/mongo-driver`
- Prisma schema: `provider = "mongodb"`

### Redis

**Признаки:**
- `package.json` dependencies: `redis`, `ioredis`
- `requirements.txt`: `redis`, `aioredis`
- `go.mod`: `github.com/go-redis/redis`

### MariaDB

Те же признаки, что и MySQL (часто используют один драйвер).

---

## Специальные случаи

### Monorepo

Если в корне репо есть `package.json` с `workspaces` или `pnpm-workspace.yaml` или `lerna.json`:
→ Это monorepo

Действия:
1. Найди все приложения: `packages/*`, `apps/*`
2. Покажи список пользователю: "Какое приложение деплоить?"
3. После выбора — анализируй только эту директорию

### Turborepo

Файл `turbo.json` → Turborepo monorepo.
Аналогично, найди приложения в `apps/`.

### Nx monorepo

Файл `nx.json` → Nx monorepo.
Используй `nx show projects` для списка проектов.

### Full-stack приложение в одном репо

Если есть и `frontend/` и `backend/` директории:
→ Спроси пользователя: "Деплоить frontend, backend или оба?"

Если оба → предложи Docker Compose подход.

---

## Примеры детекции

### Пример 1: Next.js + Prisma

```
Файлы:
  package.json → dependencies: { "next": "14.0.0", "@prisma/client": "5.0.0" }
  prisma/schema.prisma → datasource db { provider = "postgresql" }
  .env.example → DATABASE_URL=, NEXTAUTH_SECRET=, NEXTAUTH_URL=

Результат:
  Stack: Next.js 14
  Build Type: nixpacks
  Port: 3000
  Env (секреты): NEXTAUTH_SECRET
  Env (авто): DATABASE_URL, NEXTAUTH_URL
  Dependencies: PostgreSQL
```

### Пример 2: FastAPI + MongoDB

```
Файлы:
  requirements.txt → fastapi, uvicorn, motor
  main.py → app.run(host="0.0.0.0", port=8000)
  .env.example → MONGO_URL=, SECRET_KEY=

Результат:
  Stack: FastAPI
  Build Type: nixpacks
  Port: 8000
  Env (секреты): SECRET_KEY
  Env (авто): MONGO_URL (если создаём MongoDB)
  Dependencies: MongoDB
```

### Пример 3: Docker Compose microservices

```
Файлы:
  docker-compose.yml →
    services:
      frontend: { build: ./frontend }
      backend: { build: ./backend }
      db: { image: postgres:15 }

Результат:
  Stack: Docker Compose
  Build Type: compose
  Port: определяется из конфига compose (expose, ports)
  Env: из .env файлов сервисов
  Dependencies: PostgreSQL (из compose)
```

---

## Fallback на неизвестный стек

Если не удалось определить стек:

1. Покажи найденные файлы:
   ```
   Не удалось автоматически определить стек проекта.
   Найдены файлы: package.json, index.js, README.md
   ```

2. Спроси пользователя:
   ```
   Какой стек использует проект?
   1. Node.js (Nixpacks)
   2. Python (Nixpacks)
   3. Docker (есть Dockerfile)
   4. Docker Compose
   5. Статичный сайт (HTML/CSS/JS)
   6. Другое (укажи команду build и start)
   ```

3. После выбора — попроси дополнительную информацию (порт, команды и т.д.)
