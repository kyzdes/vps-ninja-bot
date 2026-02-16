# PRD: VPS Ninja — Claude Code Skill для автоматизации VPS и деплоя

## 1. Обзор проекта

### Что это
**VPS Ninja** — приватный Claude Code skill, который превращает Claude в полноценного DevOps-инженера. Через простые текстовые команды пользователь может настроить VPS с нуля, задеплоить любой проект из GitHub и автоматически привязать домен через CloudFlare — всё без ручной работы с серверами и панелями управления.

### Проблема
- Настройка VPS, Dokploy, DNS, SSL — рутина, которую не хочется делать руками
- Каждый проект требует одних и тех же шагов: создать проект в Dokploy, задать env-переменные, настроить домен, DNS-запись, SSL
- Разные проекты имеют разные стеки, и нужно каждый раз разбираться с настройками билда
- Ошибки в ручной конфигурации приводят к потере времени

### Решение
Один skill для Claude Code, который покрывает полный цикл:
```
/vps setup 123.45.67.89 root:password    → настроенный VPS с Dokploy
/vps deploy github.com/user/repo          → работающий проект на сервере
/vps domain app.example.com project-name   → привязанный домен с SSL
```

### Целевой пользователь
Единственный пользователь — автор проекта. Skill приватный, хранится в `~/.claude/skills/vps/`.

---

## 2. Архитектура

### Компоненты системы

```
┌─────────────────────────────────────────────────────────┐
│                     Claude Code                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │          VPS Ninja Skill (SKILL.md)               │   │
│  │                                                    │   │
│  │  /vps setup    → SSH → Install Dokploy            │   │
│  │  /vps deploy   → SSH → Dokploy API → Deploy App   │   │
│  │  /vps domain   → CF API + Dokploy API → Domain    │   │
│  │  /vps db       → Dokploy API → Database           │   │
│  │  /vps status   → Dokploy API → Status Report      │   │
│  │  /vps logs     → Dokploy API → Logs               │   │
│  │  /vps destroy  → Dokploy API → Cleanup            │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│              ┌───────────┼───────────┐                   │
│              ▼           ▼           ▼                   │
│          SSH (22)   Dokploy API  CloudFlare API          │
│                     (port 3000)  (api.cloudflare.com)    │
└─────────────────────────────────────────────────────────┘
              │           │           │
              ▼           ▼           ▼
         ┌─────────┐  ┌───────┐  ┌──────────┐
         │   VPS   │  │Dokploy│  │CloudFlare│
         │ (Linux) │  │  API  │  │   DNS    │
         └─────────┘  └───────┘  └──────────┘
```

### Взаимодействие с VPS

**Двухфазный подход:**

1. **Фаза настройки (SSH напрямую):**
   - Подключение по SSH через `ssh` / `sshpass` из Bash
   - Установка Dokploy и базовая конфигурация сервера
   - Генерация API-ключа Dokploy
   - Сохранение credentials в локальный конфиг

2. **Фаза эксплуатации (Dokploy API + SSH):**
   - Создание проектов, приложений, баз данных — через REST API Dokploy
   - Деплой и управление — через REST API Dokploy
   - Диагностика и нестандартные операции — SSH fallback

### Хранение конфигурации

```
~/.claude/skills/vps/
├── SKILL.md                    # Основной skill с инструкциями
├── config/
│   └── servers.json            # Реестр серверов и их credentials
├── templates/
│   ├── setup-server.sh         # Скрипт первоначальной настройки VPS
│   └── detect-stack.md         # Инструкции по определению стека проекта
└── scripts/
    ├── cloudflare.sh           # Обёртка для CloudFlare API
    └── dokploy.sh              # Обёртка для Dokploy API
```

### Файл конфигурации серверов (`servers.json`)

```json
{
  "servers": {
    "main": {
      "name": "main",
      "host": "123.45.67.89",
      "ssh_user": "root",
      "dokploy_url": "http://123.45.67.89:3000",
      "dokploy_api_key": "dk_...",
      "added_at": "2026-02-16"
    }
  },
  "cloudflare": {
    "api_token": "cf_...",
    "account_id": "..."
  },
  "defaults": {
    "server": "main",
    "build_type": "nixpacks"
  }
}
```

> **Безопасность:** Файл `servers.json` хранится только локально в `~/.claude/skills/vps/config/`. Никогда не коммитится в репозитории. Skill при первом запуске спросит credentials и сохранит их.

---

## 3. Команды (User Interface)

### 3.1 `/vps setup` — Настройка сервера с нуля

**Синтаксис:**
```
/vps setup <ip> <root-password>
/vps setup                          # Спросит IP и пароль интерактивно
```

**Что делает:**
1. Подключается по SSH к серверу
2. Обновляет систему (`apt update && apt upgrade`)
3. Настраивает firewall (UFW: порты 22, 80, 443, 3000)
4. Устанавливает Dokploy (`curl -sSL https://dokploy.com/install.sh | sh`)
5. Ждёт готовности Dokploy (проверяет порт 3000)
6. Создаёт admin-аккаунт через первичную настройку
7. Генерирует API-ключ
8. Сохраняет данные сервера в `servers.json`
9. Опционально: настраивает swap, fail2ban, unattended-upgrades
10. Выводит итоговый отчёт

**Пример взаимодействия:**
```
User: /vps setup 45.55.67.89 mypassword123

Claude: Подключаюсь к серверу 45.55.67.89...
✓ SSH подключение установлено
✓ Ubuntu 22.04 LTS обнаружена
✓ Система обновлена
✓ Firewall настроен (22, 80, 443, 3000)
✓ Dokploy установлен
✓ Dokploy доступен на http://45.55.67.89:3000
✓ Admin-аккаунт создан
✓ API-ключ сохранён

Сервер "main" готов к работе!
Теперь можно деплоить: /vps deploy <github-url>
```

**Обработка ошибок:**
- SSH не подключается → проверить IP, пароль, порт 22
- Порт 3000 занят → предложить альтернативный порт
- Мало RAM (< 2GB) → предупредить, предложить swap
- Dokploy не стартует → показать логи, предложить ручную диагностику

---

### 3.2 `/vps deploy` — Деплой проекта

**Синтаксис:**
```
/vps deploy <github-url> [--server <name>] [--domain <domain>] [--branch <branch>]
/vps deploy github.com/user/repo
/vps deploy github.com/user/repo --domain app.example.com
```

**Что делает:**

**Фаза 1 — Анализ проекта (автоматическая):**
1. Клонирует репозиторий локально (shallow clone)
2. Анализирует стек проекта:
   - `package.json` → Node.js (определяет Next.js / Express / NestJS и т.д.)
   - `requirements.txt` / `pyproject.toml` → Python (Django / FastAPI / Flask)
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `Dockerfile` → Docker (используется как есть)
   - `docker-compose.yml` → Docker Compose
   - `Gemfile` → Ruby on Rails
   - `pom.xml` / `build.gradle` → Java
   - `*.csproj` → .NET
3. Определяет порт приложения (из кода, Dockerfile, конфигов)
4. Определяет необходимые env-переменные (из `.env.example`, `.env.template`, кода)
5. Определяет нужные базы данных (из зависимостей, конфигов)
6. Определяет тип билда для Dokploy (Nixpacks / Dockerfile / Docker Compose)

**Фаза 2 — Уточнение у пользователя:**
- Показывает результат анализа
- Спрашивает значения секретных env-переменных (API keys, DB passwords и т.д.)
- Спрашивает домен (если не указан в команде)
- Спрашивает ветку (если не указана, по умолчанию main/master)
- Предлагает создать базы данных, если обнаружены зависимости

**Фаза 3 — Деплой:**
1. Создаёт проект в Dokploy (`POST /api/project.create`)
2. Если нужны БД — создаёт их (`POST /api/postgres.create`, и т.д.)
3. Создаёт приложение в проекте:
   - Для обычных проектов: `POST /api/application.create`
   - Для docker-compose: `POST /api/compose.create`
4. Настраивает Git-провайдер и привязывает репозиторий
5. Устанавливает тип билда (`POST /api/application.saveBuildType`)
6. Устанавливает env-переменные (`POST /api/application.saveEnvironment`)
7. Добавляет домен (`POST /api/domain.create` → domain для Traefik)
8. Создаёт DNS-запись в CloudFlare (A-запись → IP сервера)
9. Запускает деплой (`POST /api/application.deploy`)
10. Мониторит билд-логи в реальном времени
11. Проверяет доступность приложения по домену
12. Выводит итоговый отчёт

**Пример взаимодействия:**
```
User: /vps deploy github.com/user/my-nextjs-app --domain app.example.com

Claude: Анализирую репозиторий...

Обнаружен стек:
  Framework: Next.js 14 (App Router)
  Runtime: Node.js 20
  Порт: 3000
  Тип билда: Nixpacks
  Нужны переменные:
    - DATABASE_URL (обязательна)
    - NEXTAUTH_SECRET (обязательна)
    - NEXTAUTH_URL (установлю автоматически → https://app.example.com)

Обнаружена зависимость: PostgreSQL (из prisma schema)

Нужно создать базу данных PostgreSQL? [Да / Нет / У меня уже есть URL]

User: Да

Claude: Укажите значения для env-переменных:
  NEXTAUTH_SECRET = ?

User: my-secret-key-123

Claude: Деплою...
✓ Проект "my-nextjs-app" создан в Dokploy
✓ PostgreSQL создан (internal URL: postgres://...)
✓ Приложение создано (Nixpacks, branch: main)
✓ Env-переменные установлены (DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL)
✓ DNS A-запись app.example.com → 45.55.67.89 создана в CloudFlare
✓ Домен app.example.com добавлен в Dokploy
✓ Билд запущен...
  [============================] 100% — Build successful
✓ SSL сертификат выпущен (Let's Encrypt)
✓ Приложение доступно: https://app.example.com

Деплой завершён!
```

**Определение стека — логика:**

| Файл                  | Стек             | Тип билда      | Порт по умолчанию |
|:----------------------|:-----------------|:---------------|:-------------------|
| `next.config.*`       | Next.js          | Nixpacks       | 3000               |
| `nuxt.config.*`       | Nuxt             | Nixpacks       | 3000               |
| `angular.json`        | Angular          | Nixpacks       | 4200 → 80 (prod)   |
| `vite.config.*`       | Vite SPA         | Static          | 80                 |
| `nest-cli.json`       | NestJS           | Nixpacks       | 3000               |
| `manage.py`           | Django           | Nixpacks       | 8000               |
| `main.py` + fastapi   | FastAPI          | Nixpacks       | 8000               |
| `main.go`             | Go               | Nixpacks       | 8080               |
| `Cargo.toml`          | Rust             | Nixpacks       | 8080               |
| `Dockerfile`          | Docker           | Dockerfile     | из EXPOSE          |
| `docker-compose.yml`  | Docker Compose   | Compose        | из конфига         |

---

### 3.3 `/vps domain` — Управление доменами

**Синтаксис:**
```
/vps domain add <domain> <project-name> [--port <port>]
/vps domain remove <domain>
/vps domain list [--server <name>]
```

**Что делает (add):**
1. Получает IP сервера из конфига
2. Создаёт/обновляет DNS A-запись в CloudFlare (с Proxy включённым)
3. Добавляет домен в Dokploy для указанного приложения
4. Ждёт выпуска SSL-сертификата
5. Проверяет доступность по HTTPS

---

### 3.4 `/vps db` — Управление базами данных

**Синтаксис:**
```
/vps db create <type> <name> [--project <project>]
/vps db list
/vps db delete <name>
```

**Поддерживаемые типы:** `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

**Что делает:**
1. Создаёт БД через Dokploy API
2. Возвращает connection string (internal и external)
3. Предлагает добавить connection string в env нужного приложения

---

### 3.5 `/vps status` — Статус сервера и проектов

**Синтаксис:**
```
/vps status [--server <name>]
```

**Что делает:**
1. Опрашивает Dokploy API (`project.all`)
2. Проверяет статус каждого приложения
3. Показывает использование ресурсов сервера (через SSH: `df`, `free`, `docker stats`)
4. Выводит красивый отчёт

**Пример вывода:**
```
Сервер: main (45.55.67.89)
CPU: 23%  RAM: 1.2/4 GB  Disk: 18/80 GB

Проекты:
┌─────────────────┬──────────┬─────────────────────────┬────────┐
│ Проект          │ Статус   │ Домен                   │ Порт   │
├─────────────────┼──────────┼─────────────────────────┼────────┤
│ my-nextjs-app   │ ● Running│ app.example.com         │ 3000   │
│ api-service     │ ● Running│ api.example.com         │ 8080   │
│ landing-page    │ ○ Stopped│ example.com             │ 80     │
└─────────────────┴──────────┴─────────────────────────┴────────┘
```

---

### 3.6 `/vps logs` — Просмотр логов

**Синтаксис:**
```
/vps logs <project-name> [--lines <n>] [--build]
```

**Что делает:**
- `--build` — логи последнего билда (из Dokploy deployment logs)
- Без флага — runtime логи приложения (через `docker service logs`)

---

### 3.7 `/vps destroy` — Удаление проекта

**Синтаксис:**
```
/vps destroy <project-name> [--keep-db] [--keep-dns]
```

**Что делает:**
1. **Запрашивает подтверждение** (всегда!)
2. Останавливает приложение
3. Удаляет проект из Dokploy
4. Удаляет DNS-запись из CloudFlare (если не `--keep-dns`)
5. Удаляет базу данных (если не `--keep-db`)
6. Выводит отчёт об удалённых ресурсах

---

### 3.8 `/vps config` — Управление конфигурацией

**Синтаксис:**
```
/vps config                          # Показать текущую конфигурацию
/vps config cloudflare <api-token>   # Настроить CloudFlare
/vps config server add <name> <ip>   # Добавить сервер
/vps config server remove <name>     # Удалить сервер
/vps config default <server-name>    # Установить сервер по умолчанию
```

---

## 4. Интеграция с CloudFlare

### Авторизация
- Используется CloudFlare API Token (не Global API Key)
- Токен должен иметь права: `Zone:DNS:Edit`, `Zone:Zone:Read`
- Токен сохраняется в `servers.json`

### Автоматические операции

**При деплое нового проекта:**
1. Определить zone ID по домену (через `GET /zones?name=example.com`)
2. Создать A-запись (через `POST /zones/:zone_id/dns_records`)
   - Type: A
   - Name: subdomain (например `app`)
   - Content: IP сервера
   - Proxied: true (CloudFlare Proxy)
   - TTL: auto
3. Если запись уже существует — обновить (`PUT`)

**При удалении проекта:**
1. Найти DNS-запись по имени
2. Удалить (`DELETE /zones/:zone_id/dns_records/:record_id`)

### Обработка SSL
- При CloudFlare Proxy (Proxied: true): SSL обрабатывается CloudFlare
- Dokploy/Traefik настраивается на работу с Flexible или Full SSL от CloudFlare
- Для Full SSL: Let's Encrypt сертификат на стороне Dokploy + CloudFlare Proxy

---

## 5. Автоматическое распознавание стека

### Процесс анализа

Claude выполняет анализ в следующем порядке:

```
1. Клонировать репо (shallow, --depth 1)
2. Проверить наличие docker-compose.yml → Docker Compose flow
3. Проверить наличие Dockerfile → Docker flow
4. Проверить package.json:
   a. dependencies/devDependencies → определить фреймворк
   b. scripts.start / scripts.build → определить команды
   c. engines → определить версию Node.js
5. Проверить другие маркерные файлы (requirements.txt, go.mod, etc.)
6. Проанализировать код для определения порта:
   a. Dockerfile EXPOSE
   b. .listen(PORT) / .listen(3000)
   c. Конфиг-файлы фреймворков
7. Найти env-переменные:
   a. .env.example / .env.template / .env.sample
   b. process.env.* / os.environ.get(*) / os.Getenv(*) в коде
   c. Prisma schema → DATABASE_URL
   d. README.md → секция Environment Variables
8. Определить зависимости от БД:
   a. prisma/drizzle → PostgreSQL
   b. mongoose/mongodb → MongoDB
   c. redis/ioredis → Redis
   d. mysql2/sequelize → MySQL
```

### Вопросы пользователю

Claude задаёт вопросы **только** если:
- Не может определить порт приложения
- Найдены env-переменные без значений по умолчанию (секреты)
- Не ясно, нужно ли создавать БД или подключить существующую
- Есть несколько возможных entry point

Claude **не спрашивает**, а решает сам:
- Тип билда (Nixpacks / Dockerfile / Compose)
- Версию runtime
- Команды build/start
- Нужен ли HTTPS (всегда да)
- Настройки Traefik

---

## 6. Техническая реализация Skill

### Структура файлов

```
~/.claude/skills/vps/
├── SKILL.md                              # Главный файл skill
├── config/
│   └── servers.json                      # Credentials серверов (gitignored)
├── scripts/
│   ├── ssh-exec.sh                       # Обёртка для SSH-команд
│   ├── dokploy-api.sh                    # Обёртка для Dokploy REST API
│   ├── cloudflare-api.sh                 # Обёртка для CloudFlare API
│   ├── detect-stack.sh                   # Определение стека проекта
│   └── wait-for-deploy.sh               # Мониторинг статуса деплоя
└── templates/
    ├── setup-server.sh                   # Шаблон настройки VPS
    └── docker-compose-template.yml       # Шаблон для compose-проектов
```

### SKILL.md — Frontmatter

```yaml
---
name: vps
description: >
  Deploy and manage applications on VPS servers with Dokploy. Use when the user
  wants to set up a server, deploy a project from GitHub, manage domains, databases,
  or check server status. Triggers on mentions of VPS, deploy, server setup, Dokploy,
  or hosting.
argument-hint: "[setup|deploy|domain|db|status|logs|destroy|config] [args...]"
disable-model-invocation: true
allowed-tools:
  - Bash(ssh *)
  - Bash(sshpass *)
  - Bash(scp *)
  - Bash(curl *)
  - Bash(git clone *)
  - Bash(cat *)
  - Bash(jq *)
  - Bash(sleep *)
  - Read
  - Write
  - Glob
  - Grep
  - WebFetch
---
```

### Скрипты-обёртки

**`dokploy-api.sh`** — Универсальная обёртка для Dokploy API:
```bash
#!/bin/bash
# Usage: dokploy-api.sh <server-name> <method> <endpoint> [json-body]
# Example: dokploy-api.sh main POST application.deploy '{"applicationId":"abc"}'

SERVER=$1; METHOD=$2; ENDPOINT=$3; BODY=$4
CONFIG=~/.claude/skills/vps/config/servers.json

URL=$(jq -r ".servers.\"$SERVER\".dokploy_url" "$CONFIG")
KEY=$(jq -r ".servers.\"$SERVER\".dokploy_api_key" "$CONFIG")

if [ -n "$BODY" ]; then
  curl -s -X "$METHOD" "${URL}/api/${ENDPOINT}" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${KEY}" \
    -d "$BODY"
else
  curl -s -X "$METHOD" "${URL}/api/${ENDPOINT}" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${KEY}"
fi
```

**`cloudflare-api.sh`** — Обёртка для CloudFlare API:
```bash
#!/bin/bash
# Usage: cloudflare-api.sh <method> <path> [json-body]
# Example: cloudflare-api.sh GET "zones?name=example.com"
# Example: cloudflare-api.sh POST "zones/ZONE_ID/dns_records" '{"type":"A",...}'

METHOD=$1; PATH_=$2; BODY=$3
CONFIG=~/.claude/skills/vps/config/servers.json
TOKEN=$(jq -r ".cloudflare.api_token" "$CONFIG")

if [ -n "$BODY" ]; then
  curl -s -X "$METHOD" "https://api.cloudflare.com/client/v4/${PATH_}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY"
else
  curl -s -X "$METHOD" "https://api.cloudflare.com/client/v4/${PATH_}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json"
fi
```

---

## 7. Сценарии использования (E2E)

### Сценарий 1: Первоначальная настройка

```
User: /vps setup 45.55.67.89 MyR00tPass!

# Claude подключается по SSH, ставит Dokploy, всё настраивает
# Результат: сервер готов, данные сохранены
```

### Сценарий 2: Деплой Next.js + Prisma проекта

```
User: /vps deploy github.com/myuser/saas-app --domain app.mysaas.com

# Claude:
# 1. Клонирует, анализирует → Next.js + Prisma + PostgreSQL
# 2. Спрашивает: создать PostgreSQL? → Да
# 3. Спрашивает: NEXTAUTH_SECRET? → user вводит
# 4. Создаёт проект, БД, приложение в Dokploy
# 5. Создаёт DNS в CloudFlare
# 6. Деплоит, ждёт, проверяет
# Результат: https://app.mysaas.com работает
```

### Сценарий 3: Деплой Docker Compose проекта

```
User: /vps deploy github.com/myuser/microservices

# Claude:
# 1. Клонирует, находит docker-compose.yml
# 2. Анализирует сервисы в compose
# 3. Спрашивает: какие домены для каких сервисов?
# 4. Спрашивает: env-переменные (секреты)
# 5. Создаёт compose-проект в Dokploy
# 6. Настраивает external network: dokploy-network
# 7. Деплоит
# Результат: все сервисы работают
```

### Сценарий 4: Деплой Python API

```
User: /vps deploy github.com/myuser/ml-api --domain api.example.com

# Claude:
# 1. Клонирует, находит requirements.txt + main.py с FastAPI
# 2. Определяет: FastAPI, порт 8000, Nixpacks
# 3. Находит .env.example → OPENAI_API_KEY, DB_URL
# 4. Спрашивает значения
# 5. Деплоит
# Результат: https://api.example.com работает
```

### Сценарий 5: Быстрая проверка статуса

```
User: /vps status

# Claude показывает таблицу всех проектов, их статусы, домены, ресурсы сервера
```

---

## 8. Обработка ошибок и edge cases

### Ошибки подключения
| Ошибка | Действие |
|:-------|:---------|
| SSH timeout | Проверить IP, firewall, порт 22. Предложить проверить в панели хостера |
| SSH auth failed | Проверить пароль. Предложить SSH-ключ |
| Dokploy API недоступен | Проверить порт 3000 через SSH, перезапустить Dokploy |
| CloudFlare API 403 | Проверить токен, права на зону |

### Ошибки деплоя
| Ошибка | Действие |
|:-------|:---------|
| Build failed | Показать последние 50 строк лога, предложить исправления |
| Port conflict | Предложить другой порт, проверить занятые порты |
| Out of memory | Показать `free -h`, предложить swap или убить другие процессы |
| DNS not propagated | Подождать, проверить через `dig`, убедиться что A-запись создана |
| SSL не выпускается | Проверить DNS propagation, порты 80/443, CloudFlare proxy settings |

### Edge cases
- Проект без `.env.example` — сканировать код на `process.env.*` / `os.environ`
- Monorepo — спросить пользователя какой пакет деплоить, настроить root directory
- Private repo — настроить Git-провайдер в Dokploy или использовать deploy key
- Проект с несколькими сервисами — предложить Docker Compose подход
- Уже задеплоенный проект — предложить редеплой вместо создания нового

---

## 9. Безопасность

### Принципы
1. **Credentials только локально** — `servers.json` никогда не попадает в git
2. **Подтверждение деструктивных операций** — `destroy` всегда просит confirm
3. **Минимальные права CloudFlare** — только DNS:Edit, Zone:Read
4. **SSH через sshpass только для setup** — после настройки предпочтительно SSH-ключи
5. **Secrets не в логах** — пароли и токены маскируются при выводе

### Рекомендации после setup
- Настроить SSH-ключ вместо пароля
- Отключить root login по паролю
- Убрать порт 3000 из публичного доступа (настроить домен для Dokploy)

---

## 10. Ограничения (v1)

Что **не** входит в первую версию:
- Мультисерверный кластер (Docker Swarm multi-node)
- CI/CD пайплайны (auto-deploy по push)
- Мониторинг и алерты (Grafana, Prometheus)
- Автоматическое масштабирование
- Backup-менеджмент
- Поддержка других панелей (Coolify, CapRover)
- GitHub App интеграция для Dokploy (используем Git URL напрямую)

---

## 11. План реализации

### Фаза 1: Базовый скелет (MVP)
- [ ] Создать структуру файлов skill
- [ ] Реализовать SKILL.md с парсингом команд
- [ ] Реализовать `/vps config` — управление credentials
- [ ] Реализовать скрипты-обёртки (SSH, Dokploy API, CloudFlare API)

### Фаза 2: Setup
- [ ] Реализовать `/vps setup` — полная настройка VPS
- [ ] Тестирование на чистом Ubuntu VPS

### Фаза 3: Deploy
- [ ] Реализовать автоопределение стека
- [ ] Реализовать `/vps deploy` для обычных приложений (Nixpacks)
- [ ] Реализовать `/vps deploy` для Dockerfile-проектов
- [ ] Реализовать `/vps deploy` для Docker Compose
- [ ] Интеграция CloudFlare DNS при деплое

### Фаза 4: Управление
- [ ] Реализовать `/vps domain`
- [ ] Реализовать `/vps db`
- [ ] Реализовать `/vps status`
- [ ] Реализовать `/vps logs`
- [ ] Реализовать `/vps destroy`

### Фаза 5: Полировка
- [ ] Обработка всех edge cases
- [ ] Улучшение вывода (форматирование, прогресс)
- [ ] Документация для себя
