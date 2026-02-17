# Архитектура: VPS Ninja Skill

## 1. Обзор

VPS Ninja — это **один Claude Code skill**, состоящий из файла инструкций `SKILL.md` и набора вспомогательных shell-скриптов. Скилл не содержит ни строки application-кода — вся логика описана как инструкции для Claude, а скрипты служат детерминированными обёртками над API.

```
Пользователь          Claude Code              Внешние системы
──────────             ──────────               ────────────────

/vps deploy ...  ──►  SKILL.md загружается  ──►  SSH → VPS
                      в контекст Claude         curl → Dokploy API (:3000)
                      Claude читает             curl → CloudFlare API
                      инструкции и
                      выполняет шаги
                      через Bash/Read/Write
```

**Ключевой принцип:** Claude — это runtime. SKILL.md — это программа. Скрипты — это stdlib.

---

## 2. Расположение и структура файлов

```
~/.claude/skills/vps/
│
├── SKILL.md                          # 1. Точка входа — инструкции для Claude
│                                     #    ~400 строк, frontmatter + markdown
│
├── references/
│   ├── deploy-guide.md               # 2. Детальный гайд по deploy flow
│   ├── setup-guide.md                # 3. Детальный гайд по setup flow
│   ├── stack-detection.md            # 4. Правила определения стека проекта
│   └── dokploy-api-reference.md      # 5. Справочник endpoints Dokploy API
│
├── scripts/
│   ├── dokploy-api.sh                # 6. Обёртка: curl → Dokploy REST API
│   ├── cloudflare-dns.sh             # 7. Обёртка: curl → CloudFlare DNS API
│   ├── ssh-exec.sh                   # 8. Обёртка: SSH-команды на сервере
│   └── wait-ready.sh                 # 9. Polling: ждать готовности сервиса
│
├── templates/
│   └── setup-server.sh               # 10. Скрипт начальной настройки VPS
│
└── config/
    └── servers.json                  # 11. Credentials (только локально)
```

### Почему такая структура

| Проблема | Решение |
|:---------|:--------|
| SKILL.md > 500 строк → раздувает контекст | Основные инструкции в SKILL.md (~400 строк), детали в `references/` — Claude подгружает по необходимости через Read |
| Claude может запутаться в сложных curl-командах | Shell-скрипты инкапсулируют API-вызовы. Claude вызывает `dokploy-api.sh POST application.deploy '{"id":"x"}'` вместо сырого curl |
| Credentials нельзя хардкодить | `servers.json` в отдельной директории, скрипты читают его через `jq` |
| Разные команды требуют разного контекста | `references/` грузится выборочно: `/vps setup` → `setup-guide.md`, `/vps deploy` → `deploy-guide.md` + `stack-detection.md` |

---

## 3. SKILL.md — точка входа

### Frontmatter

```yaml
---
name: vps
description: >
  Deploy and manage applications on VPS servers with Dokploy.
  Use when the user wants to: set up a new VPS server, deploy a project
  from GitHub, manage domains/DNS, create databases, check server status,
  view logs, or remove deployed projects.
  Triggers on: VPS, deploy, server setup, Dokploy, hosting, домен, деплой, сервер.
argument-hint: "[setup|deploy|domain|db|status|logs|destroy|config] [args...]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - WebFetch
---
```

**Ключевые решения:**

| Поле | Значение | Почему |
|:-----|:---------|:-------|
| `disable-model-invocation: true` | Claude не вызывает skill автоматически | Skill работает с серверами — случайный вызов опасен. Только `/vps` вручную |
| `allowed-tools: Bash` | Полный доступ к Bash | Нужен SSH, curl, git clone, jq — ограничивать конкретные команды непрактично, т.к. SSH-команды динамические |
| `allowed-tools: Read, Write` | Чтение/запись файлов | Читать конфиг, анализировать клонированный репо, писать конфиг |

### Body — маршрутизация команд

SKILL.md содержит **маршрутизатор** — секцию, которая по `$ARGUMENTS` определяет какой flow выполнять и какой reference-файл загружать:

```markdown
## Как работать с этим skill

Ты — DevOps-инженер. Тебе поступает команда от пользователя через `$ARGUMENTS`.

### Маршрутизация команд

Определи команду из первого аргумента `$0`:

| Команда    | Действие                                                          |
|:-----------|:------------------------------------------------------------------|
| `setup`    | Прочитай `~/.claude/skills/vps/references/setup-guide.md` и выполни |
| `deploy`   | Прочитай `deploy-guide.md` и `stack-detection.md`, выполни         |
| `domain`   | Управление доменами (инструкции ниже)                              |
| `db`       | Управление базами данных (инструкции ниже)                         |
| `status`   | Получи статус сервера и проектов (инструкции ниже)                 |
| `logs`     | Покажи логи приложения (инструкции ниже)                           |
| `destroy`  | Удали проект (инструкции ниже, ВСЕГДА проси подтверждение)         |
| `config`   | Управление конфигурацией (инструкции ниже)                         |
| (пусто)    | Покажи список доступных команд                                     |
```

### Body — inline-инструкции для простых команд

Команды `domain`, `db`, `status`, `logs`, `destroy`, `config` достаточно короткие и описаны прямо в SKILL.md. Только `setup` и `deploy` вынесены в references, потому что они сложные.

### Body — общие правила

```markdown
### Общие правила

1. **Конфигурация**: Перед любой операцией прочитай
   `~/.claude/skills/vps/config/servers.json`.
   Если файл не существует и команда не `config` — попроси настроить:
   "Сначала настрой сервер: `/vps config server add <name> <ip>`"

2. **Скрипты**: Используй скрипты из `~/.claude/skills/vps/scripts/`:
   - `dokploy-api.sh <server> <METHOD> <endpoint> [body]` — Dokploy API
   - `cloudflare-dns.sh <action> [args...]` — CloudFlare DNS
   - `ssh-exec.sh <server> <command>` — SSH команды
   - `wait-ready.sh <url> [timeout_sec]` — ожидание доступности

3. **Безопасность**:
   - Никогда не выводи API-ключи, пароли, токены в текст ответа
   - Перед `destroy` ВСЕГДА проси подтверждение пользователя
   - Перед любой записью DNS проси подтверждение домена

4. **Ошибки**: При ошибке API/SSH покажи что пошло не так и предложи
   конкретные шаги для исправления. Не повторяй ту же команду молча.
```

---

## 4. References — детальные гайды

### 4.1 `setup-guide.md` (~150 строк)

Загружается только при `/vps setup`. Содержит пошаговый алгоритм:

```
Секции:
├── Парсинг аргументов ($1 = IP, $2 = пароль)
├── Шаг 1: Проверка SSH-доступа
│   └── ssh-exec.sh <server> "uname -a && cat /etc/os-release"
├── Шаг 2: Проверка ресурсов
│   └── RAM >= 2GB? Disk >= 30GB? Если нет — предупредить, предложить swap
├── Шаг 3: Обновление системы
│   └── ssh-exec.sh <server> "apt update && apt upgrade -y"
├── Шаг 4: Firewall
│   └── ssh-exec.sh <server> "ufw allow 22,80,443,3000/tcp && ufw --force enable"
├── Шаг 5: Установка Dokploy
│   └── ssh-exec.sh <server> "curl -sSL https://dokploy.com/install.sh | sh"
├── Шаг 6: Ожидание готовности
│   └── wait-ready.sh "http://<ip>:3000" 180
├── Шаг 7: Первичная настройка Dokploy
│   └── curl POST /api/auth.createAdmin (email, password)
├── Шаг 8: Генерация API-ключа
│   └── Через Dokploy API или UI automation
├── Шаг 9: Сохранение в servers.json
│   └── Write tool → обновить конфиг
├── Шаг 10: Опциональные улучшения
│   └── swap, fail2ban, unattended-upgrades
└── Итоговый отчёт
```

### 4.2 `deploy-guide.md` (~200 строк)

Загружается при `/vps deploy`. Три фазы:

```
Секции:
├── Парсинг аргументов
│   └── $1 = github URL, --domain, --server, --branch
│
├── ФАЗА 1: Анализ проекта
│   ├── git clone --depth 1 <url> /tmp/vps-ninja-analyze
│   ├── Прочитай stack-detection.md и определи стек
│   ├── Найди env-переменные (из .env.example, кода, README)
│   ├── Найди зависимости от БД
│   └── Покажи результат анализа пользователю
│
├── ФАЗА 2: Уточнение
│   ├── Спроси секреты (env-переменные без значений по умолчанию)
│   ├── Спроси домен (если не передан в --domain)
│   └── Предложи создать БД (если обнаружены зависимости)
│
├── ФАЗА 3: Деплой
│   ├── dokploy-api.sh POST project.create
│   ├── [если нужна БД] dokploy-api.sh POST postgres.create / mysql.create / ...
│   ├── dokploy-api.sh POST application.create  (или compose.create)
│   ├── dokploy-api.sh POST application.update (git repo, branch, build type)
│   ├── dokploy-api.sh POST application.saveBuildType
│   ├── dokploy-api.sh POST application.saveEnvironment
│   ├── [если домен] cloudflare-dns.sh create <domain> <ip>
│   ├── [если домен] dokploy-api.sh POST domain.create
│   ├── dokploy-api.sh POST application.deploy
│   ├── Мониторинг (poll deployments до status done/error)
│   ├── [если домен] wait-ready.sh https://<domain>
│   └── Итоговый отчёт
│
└── Обработка ошибок
    ├── Build failed → показать логи, предложить фикс
    ├── DNS не резолвится → проверить CloudFlare, подождать
    └── Приложение не отвечает → проверить порт, логи
```

### 4.3 `stack-detection.md` (~100 строк)

Правила для определения стека. Claude читает этот файл и применяет к склонированному репозиторию:

```
Секции:
├── Приоритет проверок
│   └── docker-compose.yml > Dockerfile > package.json > requirements.txt > go.mod > ...
│
├── Таблица маркеров
│   └── Файл → Стек → Тип билда Dokploy → Порт по умолчанию
│
├── Определение порта
│   ├── Dockerfile: EXPOSE
│   ├── package.json: scripts.start → --port / -p
│   ├── Код: .listen(PORT) / .listen(3000)
│   └── Конфиги фреймворков: next.config.js, vite.config.ts, etc.
│
├── Определение env-переменных
│   ├── .env.example / .env.template / .env.sample → парсить ключи
│   ├── process.env.XXX в JS/TS коде
│   ├── os.environ / os.getenv в Python
│   ├── os.Getenv в Go
│   └── Prisma schema: datasource → DATABASE_URL
│
└── Определение зависимостей от БД
    ├── prisma / drizzle / typeorm → PostgreSQL
    ├── mongoose / mongodb → MongoDB
    ├── ioredis / redis → Redis
    └── mysql2 / sequelize (mysql dialect) → MySQL
```

### 4.4 `dokploy-api-reference.md` (~100 строк)

Справочник основных Dokploy API endpoints, которые использует skill:

```
Секции:
├── Аутентификация
│   └── Header: x-api-key
│
├── Проекты
│   ├── POST project.create    { name, description }
│   ├── GET  project.all
│   └── DELETE project.remove  { projectId }
│
├── Приложения
│   ├── POST application.create       { name, projectId, ... }
│   ├── POST application.update       { applicationId, sourceType, ... }
│   ├── POST application.saveBuildType { applicationId, buildType, ... }
│   ├── POST application.saveEnvironment { applicationId, env }
│   ├── POST application.deploy       { applicationId }
│   ├── POST application.stop         { applicationId }
│   ├── GET  application.one          { applicationId }
│   └── DELETE application.delete     { applicationId }
│
├── Docker Compose
│   ├── POST compose.create           { name, projectId, ... }
│   ├── POST compose.update           { composeId, sourceType, ... }
│   └── POST compose.deploy           { composeId }
│
├── Домены
│   ├── POST domain.create            { applicationId, host, port, https }
│   └── DELETE domain.delete          { domainId }
│
├── Базы данных (для каждого типа: postgres, mysql, mariadb, mongo, redis)
│   ├── POST <type>.create            { name, projectId, ... }
│   ├── POST <type>.deploy            { <type>Id }
│   ├── GET  <type>.one               { <type>Id }
│   └── DELETE <type>.remove          { <type>Id }
│
└── Деплойменты
    └── GET  deployment.all           { applicationId } → статус, логи
```

---

## 5. Scripts — детерминированные обёртки

Скрипты решают две задачи:
1. **Инкапсуляция** — Claude вызывает `dokploy-api.sh POST project.create '{...}'` вместо длинного curl с headers
2. **Надёжность** — скрипты обрабатывают ошибки, retry, парсинг JSON

### 5.1 `dokploy-api.sh`

```bash
#!/bin/bash
# Dokploy REST API wrapper
# Usage: dokploy-api.sh <server-name> <HTTP-method> <endpoint> [json-body]
#
# Examples:
#   dokploy-api.sh main GET project.all
#   dokploy-api.sh main POST project.create '{"name":"my-app"}'
#   dokploy-api.sh main POST application.deploy '{"applicationId":"abc123"}'
#
# Reads credentials from ~/.claude/skills/vps/config/servers.json
# Returns: JSON response from Dokploy API
# Exit codes: 0 = success, 1 = config error, 2 = HTTP error, 3 = network error

set -euo pipefail

SERVER="${1:?Usage: dokploy-api.sh <server> <method> <endpoint> [body]}"
METHOD="${2:?Missing HTTP method}"
ENDPOINT="${3:?Missing API endpoint}"
BODY="${4:-}"

CONFIG="$HOME/.claude/skills/vps/config/servers.json"

if [ ! -f "$CONFIG" ]; then
  echo '{"error": "Config not found. Run: /vps config server add <name> <ip>"}' >&2
  exit 1
fi

URL=$(jq -r ".servers.\"$SERVER\".dokploy_url // empty" "$CONFIG")
KEY=$(jq -r ".servers.\"$SERVER\".dokploy_api_key // empty" "$CONFIG")

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "{\"error\": \"Server '$SERVER' not found or missing API key\"}" >&2
  exit 1
fi

CURL_ARGS=(
  -s -S
  --max-time 30
  --retry 2
  --retry-delay 3
  -X "$METHOD"
  -H "Content-Type: application/json"
  -H "x-api-key: $KEY"
  -w "\n%{http_code}"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

RESPONSE=$(curl "${CURL_ARGS[@]}" "${URL}/api/${ENDPOINT}" 2>&1) || {
  echo "{\"error\": \"Network error connecting to $URL\"}" >&2
  exit 3
}

# Отделить HTTP-код от body
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_RESP=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 400 ] 2>/dev/null; then
  echo "$BODY_RESP" >&2
  exit 2
fi

echo "$BODY_RESP"
```

### 5.2 `cloudflare-dns.sh`

```bash
#!/bin/bash
# CloudFlare DNS API wrapper
# Usage:
#   cloudflare-dns.sh create <full-domain> <ip> [proxied=true]
#   cloudflare-dns.sh delete <full-domain>
#   cloudflare-dns.sh list   <zone-domain>
#   cloudflare-dns.sh get    <full-domain>
#
# Examples:
#   cloudflare-dns.sh create app.example.com 45.55.67.89
#   cloudflare-dns.sh create app.example.com 45.55.67.89 false
#   cloudflare-dns.sh delete app.example.com
#   cloudflare-dns.sh list example.com
#
# Reads CloudFlare API token from ~/.claude/skills/vps/config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = API error

set -euo pipefail

ACTION="${1:?Usage: cloudflare-dns.sh <create|delete|list|get> [args...]}"
CONFIG="$HOME/.claude/skills/vps/config/servers.json"

TOKEN=$(jq -r ".cloudflare.api_token // empty" "$CONFIG")
if [ -z "$TOKEN" ]; then
  echo '{"error": "CloudFlare token not configured. Run: /vps config cloudflare <token>"}' >&2
  exit 1
fi

CF_API="https://api.cloudflare.com/client/v4"

cf_curl() {
  local method=$1 path=$2 body=${3:-}
  local args=(-s -S --max-time 15 -X "$method"
    -H "Authorization: Bearer $TOKEN"
    -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "${CF_API}/${path}"
}

# Извлечь zone domain из full domain (app.example.com → example.com)
get_zone_domain() {
  echo "$1" | awk -F. '{print $(NF-1)"."$NF}'
}

# Получить zone ID по домену зоны
get_zone_id() {
  local zone_domain=$1
  cf_curl GET "zones?name=${zone_domain}&status=active" | jq -r '.result[0].id // empty'
}

# Найти DNS-запись по имени
find_record() {
  local zone_id=$1 record_name=$2
  cf_curl GET "zones/${zone_id}/dns_records?name=${record_name}&type=A" | jq -r '.result[0] // empty'
}

case "$ACTION" in
  create)
    DOMAIN="${2:?Missing domain}"
    IP="${3:?Missing IP address}"
    PROXIED="${4:-true}"

    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    # Проверить, существует ли запись
    EXISTING=$(find_record "$ZONE_ID" "$DOMAIN")

    if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
      # Обновить существующую
      RECORD_ID=$(echo "$EXISTING" | jq -r '.id')
      cf_curl PUT "zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
        "{\"type\":\"A\",\"name\":\"$DOMAIN\",\"content\":\"$IP\",\"proxied\":$PROXIED,\"ttl\":1}"
    else
      # Создать новую
      cf_curl POST "zones/${ZONE_ID}/dns_records" \
        "{\"type\":\"A\",\"name\":\"$DOMAIN\",\"content\":\"$IP\",\"proxied\":$PROXIED,\"ttl\":1}"
    fi
    ;;

  delete)
    DOMAIN="${2:?Missing domain}"
    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    EXISTING=$(find_record "$ZONE_ID" "$DOMAIN")
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
      RECORD_ID=$(echo "$EXISTING" | jq -r '.id')
      cf_curl DELETE "zones/${ZONE_ID}/dns_records/${RECORD_ID}"
    else
      echo "{\"error\": \"DNS record not found: $DOMAIN\"}" >&2
      exit 2
    fi
    ;;

  list)
    ZONE_DOMAIN="${2:?Missing zone domain}"
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")
    cf_curl GET "zones/${ZONE_ID}/dns_records?type=A" | jq '.result[] | {name, content, proxied}'
    ;;

  get)
    DOMAIN="${2:?Missing domain}"
    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")
    find_record "$ZONE_ID" "$DOMAIN"
    ;;

  *)
    echo "Unknown action: $ACTION. Use: create, delete, list, get" >&2
    exit 1
    ;;
esac
```

### 5.3 `ssh-exec.sh`

```bash
#!/bin/bash
# SSH command execution wrapper
# Usage: ssh-exec.sh <server-name> <command>
#
# Examples:
#   ssh-exec.sh main "uname -a"
#   ssh-exec.sh main "docker ps"
#   ssh-exec.sh main "free -h && df -h"
#
# For initial setup with password: ssh-exec.sh --password <pass> <ip> <command>
#
# Reads SSH credentials from ~/.claude/skills/vps/config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = SSH error

set -euo pipefail

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR"

# Режим с паролем (для initial setup, когда сервера ещё нет в конфиге)
if [ "$1" = "--password" ]; then
  PASSWORD="${2:?Missing password}"
  HOST="${3:?Missing host}"
  CMD="${4:?Missing command}"
  sshpass -p "$PASSWORD" ssh $SSH_OPTS "root@${HOST}" "$CMD"
  exit $?
fi

# Обычный режим — из конфига
SERVER="${1:?Usage: ssh-exec.sh <server-name> <command>}"
CMD="${2:?Missing command}"
CONFIG="$HOME/.claude/skills/vps/config/servers.json"

HOST=$(jq -r ".servers.\"$SERVER\".host // empty" "$CONFIG")
USER=$(jq -r ".servers.\"$SERVER\".ssh_user // \"root\"" "$CONFIG")
SSH_KEY=$(jq -r ".servers.\"$SERVER\".ssh_key // empty" "$CONFIG")

if [ -z "$HOST" ]; then
  echo "Server '$SERVER' not found in config" >&2
  exit 1
fi

if [ -n "$SSH_KEY" ]; then
  ssh $SSH_OPTS -i "$SSH_KEY" "${USER}@${HOST}" "$CMD"
else
  ssh $SSH_OPTS "${USER}@${HOST}" "$CMD"
fi
```

### 5.4 `wait-ready.sh`

```bash
#!/bin/bash
# Wait for a URL to become accessible
# Usage: wait-ready.sh <url> [timeout_seconds] [interval_seconds]
#
# Examples:
#   wait-ready.sh http://45.55.67.89:3000 180
#   wait-ready.sh https://app.example.com 120 5
#
# Exit codes: 0 = ready, 1 = timeout

URL="${1:?Usage: wait-ready.sh <url> [timeout] [interval]}"
TIMEOUT="${2:-120}"
INTERVAL="${3:-5}"

ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
    echo "{\"status\": \"ready\", \"url\": \"$URL\", \"http_code\": $HTTP_CODE, \"elapsed\": $ELAPSED}"
    exit 0
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "{\"status\": \"timeout\", \"url\": \"$URL\", \"timeout\": $TIMEOUT}" >&2
exit 1
```

---

## 6. Config — управление состоянием

### `servers.json` — единственный stateful-файл

```json
{
  "servers": {
    "main": {
      "host": "45.55.67.89",
      "ssh_user": "root",
      "ssh_key": "",
      "dokploy_url": "http://45.55.67.89:3000",
      "dokploy_api_key": "dk_abc123...",
      "added_at": "2026-02-17"
    },
    "staging": {
      "host": "67.89.12.34",
      "ssh_user": "root",
      "ssh_key": "~/.ssh/staging_rsa",
      "dokploy_url": "http://67.89.12.34:3000",
      "dokploy_api_key": "dk_xyz789...",
      "added_at": "2026-02-18"
    }
  },
  "cloudflare": {
    "api_token": "cf_..."
  },
  "defaults": {
    "server": "main"
  }
}
```

**Принципы:**
- Файл создаётся при первом `/vps config`
- Claude читает его через `Read` tool (или `jq` в скриптах)
- Claude пишет в него через `Write` tool
- Скрипты **только читают** — никогда не модифицируют
- Никогда не выводится в ответ пользователю целиком (содержит секреты)

---

## 7. Потоки данных (Data Flows)

### Flow 1: `/vps setup <ip> <password>`

```
┌──────────┐    ┌───────────┐    ┌──────────────────┐    ┌──────────┐
│ Пользо-  │    │  Claude   │    │   VPS (SSH)       │    │ servers  │
│ ватель   │    │  (Skill)  │    │                   │    │  .json   │
└────┬─────┘    └─────┬─────┘    └────────┬──────────┘    └────┬─────┘
     │                │                    │                    │
     │ /vps setup     │                    │                    │
     │ 45.55.67.89    │                    │                    │
     │ password123    │                    │                    │
     ├───────────────►│                    │                    │
     │                │                    │                    │
     │                │ Read setup-guide   │                    │
     │                │────────────────┐   │                    │
     │                │                │   │                    │
     │                │◄───────────────┘   │                    │
     │                │                    │                    │
     │                │ ssh-exec.sh        │                    │
     │                │ --password ...     │                    │
     │                │ "uname -a"        │                    │
     │                ├───────────────────►│                    │
     │                │◄───────────────────┤ Ubuntu 22.04      │
     │                │                    │                    │
     │                │ ssh-exec.sh        │                    │
     │                │ "apt update..."    │                    │
     │                ├───────────────────►│                    │
     │                │◄───────────────────┤ OK                │
     │                │                    │                    │
     │                │ ssh-exec.sh        │                    │
     │                │ "curl dokploy..."  │                    │
     │                ├───────────────────►│                    │
     │                │◄───────────────────┤ Installed          │
     │                │                    │                    │
     │                │ wait-ready.sh      │                    │
     │                │ http://IP:3000     │                    │
     │                ├───────────────────►│                    │
     │                │◄───────────────────┤ 200 OK             │
     │                │                    │                    │
     │                │ curl POST          │                    │
     │                │ /auth.createAdmin  │                    │
     │                ├───────────────────►│                    │
     │                │◄───────────────────┤ {token, apiKey}    │
     │                │                    │                    │
     │                │ Write servers.json │                    │
     │                ├────────────────────┼───────────────────►│
     │                │                    │                    │
     │  "Сервер main  │                    │                    │
     │   готов!"      │                    │                    │
     │◄───────────────┤                    │                    │
```

### Flow 2: `/vps deploy <github-url> --domain <domain>`

```
┌──────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐  ┌────────────┐
│ Пользо-  │  │  Claude   │  │  Dokploy   │  │ CloudFlare  │  │ GitHub     │
│ ватель   │  │  (Skill)  │  │  API       │  │ API         │  │ (clone)    │
└────┬─────┘  └─────┬─────┘  └──────┬─────┘  └──────┬──────┘  └──────┬─────┘
     │              │               │               │               │
     │ /vps deploy  │               │               │               │
     │ github/repo  │               │               │               │
     │ --domain x   │               │               │               │
     ├─────────────►│               │               │               │
     │              │                               │               │
     │              │ ─── ФАЗА 1: АНАЛИЗ ──────────────────────────│
     │              │                               │               │
     │              │ git clone --depth 1           │               │
     │              ├───────────────────────────────────────────────►│
     │              │◄──────────────────────────────────────────────┤
     │              │                               │               │
     │              │ Read package.json,            │               │
     │              │ Dockerfile, .env.example      │               │
     │              │ (Glob + Read + Grep)          │               │
     │              │                               │               │
     │              │ ─── ФАЗА 2: УТОЧНЕНИЕ ───────│               │
     │              │                               │               │
     │  "Обнаружен  │                               │               │
     │   Next.js,   │                               │               │
     │   нужен      │                               │               │
     │   SECRET=?"  │                               │               │
     │◄─────────────┤                               │               │
     │              │                               │               │
     │ "my-secret"  │                               │               │
     ├─────────────►│                               │               │
     │              │                               │               │
     │              │ ─── ФАЗА 3: ДЕПЛОЙ ──────────│               │
     │              │                               │               │
     │              │ POST project.create           │               │
     │              ├──────────────►│               │               │
     │              │◄──────────────┤ {projectId}   │               │
     │              │                               │               │
     │              │ POST postgres.create          │               │
     │              ├──────────────►│               │               │
     │              │◄──────────────┤ {dbId, url}   │               │
     │              │                               │               │
     │              │ POST application.create       │               │
     │              ├──────────────►│               │               │
     │              │◄──────────────┤ {appId}       │               │
     │              │                               │               │
     │              │ POST application.update       │               │
     │              │ (git URL, branch, buildType)  │               │
     │              ├──────────────►│               │               │
     │              │                               │               │
     │              │ POST application.saveEnv      │               │
     │              ├──────────────►│               │               │
     │              │                               │               │
     │              │ cloudflare-dns.sh create      │               │
     │              │ domain.com IP                 │               │
     │              ├──────────────────────────────►│               │
     │              │◄─────────────────────────────┤ A record OK   │
     │              │                               │               │
     │              │ POST domain.create            │               │
     │              ├──────────────►│               │               │
     │              │                               │               │
     │              │ POST application.deploy       │               │
     │              ├──────────────►│               │               │
     │              │                               │               │
     │              │ [poll deployment status]      │               │
     │              ├──────────────►│               │               │
     │              │◄──────────────┤ done          │               │
     │              │                               │               │
     │              │ wait-ready.sh https://domain  │               │
     │              │                               │               │
     │  "Деплой     │                               │               │
     │   завершён!  │                               │               │
     │   https://x" │                               │               │
     │◄─────────────┤                               │               │
```

### Flow 3: `/vps destroy <project>`

```
Пользователь ──► Claude ──► "Удалить project-name, БД, DNS app.example.com?"
                         ◄── Пользователь: "Да"
                         ──► Dokploy API: application.stop
                         ──► Dokploy API: application.delete
                         ──► Dokploy API: postgres.remove
                         ──► CloudFlare API: delete DNS record
                         ──► Пользователь: "Удалено ✓"
```

---

## 8. Обработка ошибок — стратегия

### Уровни ошибок

```
Level 1: Конфиг           → "Сервер не настроен. Выполни /vps config ..."
Level 2: Сеть/SSH         → retry 2 раза (встроено в скрипты), потом сообщить
Level 3: API (4xx)        → Показать ответ API, объяснить причину, предложить фикс
Level 4: API (5xx)        → Retry, если не помогло — SSH fallback для диагностики
Level 5: Build failed     → Показать tail логов, проанализировать, предложить фикс
Level 6: Runtime failed   → docker logs, проверить порт, env-переменные
```

### Пример в reference guide

```markdown
### Если билд упал

1. Получи логи последнего деплоя:
   ```
   dokploy-api.sh <server> GET "deployment.all?applicationId=<appId>"
   ```
2. Возьми `deploymentId` последнего деплоя
3. Получи логи:
   ```
   dokploy-api.sh <server> GET "deployment.logsByDeployment?deploymentId=<id>"
   ```
4. Проанализируй последние 50 строк
5. Объясни пользователю что пошло не так
6. Предложи конкретное исправление (env-переменная, порт, Dockerfile и т.д.)
```

---

## 9. Безопасность

### Модель угроз (для приватного skill)

```
┌──────────────────────────────────────────────────────┐
│                  Что защищаем                         │
├──────────────────────────────────────────────────────┤
│ 1. SSH-доступ к серверу (root!)                       │
│ 2. Dokploy API ключ (полный контроль над Dokploy)    │
│ 3. CloudFlare API токен (управление DNS)              │
│ 4. Env-переменные проектов (API keys, DB passwords)   │
└──────────────────────────────────────────────────────┘
```

### Меры защиты

| Угроза | Мера |
|:-------|:-----|
| Credentials утекают в git | `servers.json` в `~/.claude/skills/vps/config/` — вне любых git-репо |
| Credentials в выводе Claude | Инструкция в SKILL.md: "Никогда не выводи значения API-ключей, паролей, токенов" |
| Случайное удаление сервиса | `destroy` всегда требует явного подтверждения пользователя |
| Случайное перезаписание DNS | Перед DNS-операциями показать что будет изменено |
| SSH brute-force после setup | Рекомендация в post-setup: настроить SSH-ключ, отключить password auth |
| Dokploy панель открыта на 3000 | Рекомендация: настроить домен для панели и закрыть порт 3000 |

### Что НЕ делаем (осознанно)

- Не шифруем `servers.json` — это локальный файл с правами `600`, шифрование добавит сложность без реальной пользы
- Не используем vault/keychain — overkill для приватного skill одного пользователя
- Не создаём отдельного SSH-пользователя при setup — это можно добавить позже

---

## 10. Как Claude исполняет skill — пошаговая механика

```
1. Пользователь вводит: /vps deploy github.com/user/repo --domain app.example.com

2. Claude Code загружает SKILL.md в контекст:
   - Frontmatter → разрешённые tools, описание
   - $ARGUMENTS = "deploy github.com/user/repo --domain app.example.com"
   - $0 = "deploy", $1 = "github.com/user/repo", остальное — raw

3. Claude читает маршрутизатор в SKILL.md:
   - $0 = "deploy" → нужно прочитать deploy-guide.md и stack-detection.md

4. Claude вызывает Read tool:
   - Read("~/.claude/skills/vps/references/deploy-guide.md")
   - Read("~/.claude/skills/vps/references/stack-detection.md")

5. Claude вызывает Read tool:
   - Read("~/.claude/skills/vps/config/servers.json") → получает credentials

6. Claude выполняет ФАЗУ 1 (анализ):
   - Bash("git clone --depth 1 https://github.com/user/repo /tmp/vps-ninja-analyze")
   - Glob("/tmp/vps-ninja-analyze/**/package.json")
   - Read("/tmp/vps-ninja-analyze/package.json")
   - Grep("process.env", "/tmp/vps-ninja-analyze/src/")
   - Read("/tmp/vps-ninja-analyze/.env.example")

7. Claude анализирует результаты и формирует план деплоя

8. Claude выполняет ФАЗУ 2 (уточнение):
   - Выводит результат анализа пользователю
   - Спрашивает значения секретов
   - Ждёт ответа пользователя

9. Claude выполняет ФАЗУ 3 (деплой):
   - Bash("~/.claude/skills/vps/scripts/dokploy-api.sh main POST project.create '{...}'")
   - Bash("~/.claude/skills/vps/scripts/dokploy-api.sh main POST application.create '{...}'")
   - Bash("~/.claude/skills/vps/scripts/cloudflare-dns.sh create app.example.com 45.55.67.89")
   - ... и т.д. по шагам из deploy-guide.md

10. Claude выводит итоговый отчёт
```

---

## 11. Зависимости и предустановки

### На машине пользователя (где запущен Claude Code)

| Инструмент | Зачем | Как установить |
|:-----------|:------|:---------------|
| `ssh` | Подключение к VPS | Предустановлен в macOS/Linux |
| `sshpass` | SSH с паролем (для setup) | `brew install sshpass` / `apt install sshpass` |
| `curl` | HTTP-запросы к API | Предустановлен |
| `jq` | Парсинг JSON в скриптах | `brew install jq` / `apt install jq` |
| `git` | Клонирование репо для анализа | Предустановлен |

### На VPS (устанавливается при setup)

| Компонент | Устанавливает |
|:----------|:--------------|
| Docker + Docker Swarm | Dokploy install script |
| Dokploy (Next.js app) | Dokploy install script |
| PostgreSQL 16 (для Dokploy) | Dokploy install script |
| Redis 7 (для Dokploy) | Dokploy install script |
| Traefik 3.x | Dokploy install script |
| UFW | `apt install ufw` (в setup-guide) |

---

## 12. Итог: что реализовать (файлы)

| # | Файл | Строк | Описание |
|:--|:-----|:------|:---------|
| 1 | `SKILL.md` | ~400 | Frontmatter + маршрутизатор + inline-команды (domain, db, status, logs, destroy, config) |
| 2 | `references/setup-guide.md` | ~150 | Пошаговый гайд по настройке VPS |
| 3 | `references/deploy-guide.md` | ~200 | Пошаговый гайд по деплою (3 фазы) |
| 4 | `references/stack-detection.md` | ~100 | Правила определения стека проекта |
| 5 | `references/dokploy-api-reference.md` | ~100 | Справочник Dokploy API endpoints |
| 6 | `scripts/dokploy-api.sh` | ~50 | Обёртка Dokploy REST API |
| 7 | `scripts/cloudflare-dns.sh` | ~90 | Обёртка CloudFlare DNS API |
| 8 | `scripts/ssh-exec.sh` | ~40 | Обёртка SSH-команд |
| 9 | `scripts/wait-ready.sh` | ~25 | Polling доступности URL |
| 10 | `templates/setup-server.sh` | ~60 | Шаблон скрипта начальной настройки |
| **Итого** | | **~1215** | |
