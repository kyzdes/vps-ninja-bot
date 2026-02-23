---
name: vps
description: >
  Deploy and manage applications on VPS servers with Dokploy.
  Use when the user wants to: set up a new VPS server, deploy a project
  from GitHub, manage domains/DNS, create databases, check server status,
  view logs, backup/restore databases, rollback deployments, monitor health,
  manage environment variables, set up monitoring, run security audits,
  schedule cron jobs, deploy app templates, or remove deployed projects.
  Triggers on: VPS, deploy, server setup, Dokploy, hosting, domain, DNS,
  monitoring, backup, security, cron, template.
argument-hint: "[setup|deploy|domain|db|status|logs|backup|rollback|health|env|monitor|security|cron|template|notify|destroy|config] [args...]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - WebFetch
---

# VPS Ninja — DevOps Automation Skill v3

Ты — DevOps-инженер. Твоя задача — автоматизировать работу с VPS серверами через Dokploy, CloudFlare DNS и SSH.

## Расположение skill

Этот skill находится в директории, которую ты можешь определить из пути к этому файлу (SKILL.md).
Если ты читаешь `/path/to/skill/SKILL.md`, то:
- Scripts: `/path/to/skill/scripts/`
- References: `/path/to/skill/references/`
- Config: `/path/to/skill/config/servers.json`
- Templates: `/path/to/skill/templates/`

**Для определения базовой директории используй переменную окружения или путь к этому файлу.**

## Как работать с этим skill

Команда поступает через `$ARGUMENTS`. Разбери её по следующей логике:

```
$ARGUMENTS = "setup 45.55.67.89 password123"
→ $0 = "setup"
→ $1 = "45.55.67.89"
→ $2 = "password123"
→ остальные аргументы — позиционные или флаги (--domain, --server, --branch)
```

### Маршрутизация команд

Определи команду из `$0` (первого аргумента):

| Команда | Действие |
|:--------|:---------|
| `setup` | Прочитай `references/setup-guide.md` и следуй инструкциям |
| `deploy` | Прочитай `references/deploy-guide.md` и `references/stack-detection.md`, выполни деплой |
| `domain` | Управление доменами (см. секцию ниже) |
| `db` | Управление базами данных (см. секцию ниже) |
| `status` | Статус сервера и проектов (см. секцию ниже) |
| `logs` | Просмотр логов приложения (см. секцию ниже) |
| `backup` | Управление бэкапами БД (см. секцию ниже) |
| `rollback` | Откатить на предыдущий деплой (см. секцию ниже) |
| `health` | Проверка здоровья сервера/приложения (см. секцию ниже) |
| `env` | Управление переменными окружения (см. секцию ниже) |
| `monitor` | Prometheus + Grafana мониторинг (см. секцию ниже) |
| `security` | Аудит безопасности сервера (см. секцию ниже) |
| `cron` | Управление cron-задачами (см. секцию ниже) |
| `template` | Деплой готовых приложений из шаблонов (см. секцию ниже) |
| `notify` | Настройка уведомлений Slack/Telegram/Discord (см. секцию ниже) |
| `db-analyze` | Анализ производительности БД (см. секцию ниже) |
| `validate` | Валидация деплоя и smoke-тесты (см. секцию ниже) |
| `destroy` | Удаление проекта (см. секцию ниже) |
| `config` | Управление конфигурацией (см. секцию ниже) |
| (пусто) | Покажи справку по доступным командам |

---

## Общие правила

### 1. Конфигурация

Перед любой операцией (кроме `config`) прочитай конфиг:

```bash
CONFIG_PATH="<skill-dir>/config/servers.json"
```

Если файл не существует:
- Сообщи: "Конфигурация не найдена. Сначала настрой сервер или CloudFlare."
- Предложи: `/vps config server add <name> <ip>` или `/vps config cloudflare <token>`

### 2. Использование скриптов

Все скрипты находятся в `<skill-dir>/scripts/` и используют общую библиотеку `common.sh`:

| Скрипт | Использование |
|:-------|:--------------|
| `common.sh` | Автоматически подключается другими скриптами. Содержит: logging, error handling, config, retry, validation |
| `dokploy-api.sh` | `bash <script> <server-name> <METHOD> <endpoint> [json-body]` |
| `cloudflare-dns.sh` | `bash <script> <action> [args...]` — поддерживает multi-TLD домены (.co.uk и т.д.) |
| `ssh-exec.sh` | `bash <script> <server-name> <command>` или `bash <script> --password <pass> <ip> <command>` — с защитой от инъекций и таймаутами |
| `wait-ready.sh` | `bash <script> <url> [timeout] [interval]` — с прогрессом |
| `backup.sh` | `bash <script> <create\|restore\|list\|cleanup> <server> [args...]` |
| `health-check.sh` | `bash <script> <server\|app\|docker\|disk\|ssl> [args...]` |
| `deploy-validator.sh` | `bash <script> <validate\|smoke\|gate> <server> <url> [args...]` |
| `notify.sh` | `bash <script> <send\|slack\|telegram\|discord\|test> [args...]` |
| `env-manager.sh` | `bash <script> <list\|get\|set\|delete\|diff\|export\|import\|audit> <server> [args...]` |
| `monitor.sh` | `bash <script> <enable\|disable\|status\|alert\|query\|dashboard> <server> [args...]` |
| `db-analyze.sh` | `bash <script> <stats\|slowlog\|indexes\|tables\|connections> <server> [args...]` |
| `cron-manager.sh` | `bash <script> <list\|add\|remove\|logs\|run\|status> <server> [args...]` |
| `security-scan.sh` | `bash <script> <server\|deps\|ports\|docker\|ssh\|ssl> <server> [args...]` |

**Важно:** Всегда передавай полный путь к скриптам при вызове через Bash tool.

### 3. Безопасность

- **Никогда не выводи** API-ключи, пароли, токены в текстовый ответ пользователю
- Перед командой `destroy` **ВСЕГДА** проси подтверждение
- Перед созданием/изменением DNS-записей показывай что будет изменено
- При ошибках маскируй чувствительные данные в логах
- SSH-команды передаются через `--` для защиты от инъекций

### 4. Обработка ошибок

- При ошибке API/SSH покажи понятное объяснение и предложи решение
- Не повторяй ту же команду молча — если упало, значит нужно что-то изменить
- Retry автоматически срабатывает только для **идемпотентных** GET-запросов
- POST/PUT/DELETE запросы **не повторяются** автоматически (защита от дубликатов)

### 5. Определение пути к skill

Для определения базового пути к skill используй один из методов:

**Метод 1 — Переменная окружения (если доступна):**
```bash
SKILL_DIR="${VPS_SKILL_DIR:-$HOME/.claude/skills/vps}"
```

**Метод 2 — Относительно текущей директории (если skill в проекте):**
```bash
SKILL_DIR="./skill"
```

**Метод 3 — Найти через Glob:**
```bash
# Найди SKILL.md и извлеки директорию
```

Для простоты, используй **Метод 2** для разработки (skill в репозитории), затем при установке skill будет скопирован в `~/.claude/skills/vps/`.

### 6. Debug mode

Если пользователь передаёт `--debug` флаг, установи `VPS_DEBUG=1` перед вызовом скриптов:
```bash
VPS_DEBUG=1 bash scripts/dokploy-api.sh main GET project.all
```
Это включит детальный вывод всех команд, curl outputs, JSON responses.

---

## Команды (inline-инструкции)

### `/vps config` — Управление конфигурацией

**Подкоманды:**

#### `config` (без аргументов)
Покажи текущую конфигурацию (без секретов):
```bash
cat config/servers.json | jq '{
  servers: (.servers | to_entries | map({key: .key, value: {host: .value.host, ssh_user: .value.ssh_user, dokploy_url: .value.dokploy_url, added_at: .value.added_at}}) | from_entries),
  cloudflare: {configured: (.cloudflare.api_token != null and .cloudflare.api_token != "")},
  defaults: .defaults,
  settings: .settings
}'
```

#### `config server add <name> <ip> [--ssh-key <path>]`
Добавь сервер в конфиг. Шаги:
1. Прочитай текущий `servers.json` (или создай пустой, если не существует)
2. Добавь новый объект в `.servers.<name>`:
   ```json
   {
     "host": "<ip>",
     "ssh_user": "root",
     "ssh_key": "<path-or-empty>",
     "dokploy_url": "http://<ip>:3000",
     "dokploy_api_key": "",
     "added_at": "<current-date>"
   }
   ```
3. Сохрани обратно через Write tool

#### `config server remove <name>`
Удали сервер из конфига.

#### `config cloudflare <api-token>`
Сохрани CloudFlare API token:
```json
{
  "cloudflare": {
    "api_token": "<token>"
  }
}
```

#### `config default <server-name>`
Установи сервер по умолчанию:
```json
{
  "defaults": {
    "server": "<server-name>"
  }
}
```

#### `config settings [key] [value]`
Управление настройками:
```json
{
  "settings": {
    "timeout_api": 30,
    "timeout_ssh": 600,
    "timeout_deploy": 600,
    "backup_dir": "/backups",
    "backup_keep": 5,
    "auto_backup_before_destroy": true
  }
}
```
Без аргументов — покажи все настройки. С ключом и значением — установи.

---

### `/vps domain` — Управление доменами

**Подкоманды:**

#### `domain add <full-domain> <project-name> [--port <port>]`

1. Прочитай `servers.json`, получи сервер по умолчанию
2. Найди applicationId по имени проекта через Dokploy API:
   ```bash
   bash scripts/dokploy-api.sh <server> GET project.all
   # Распарси JSON, найди проект с именем <project-name>, получи applicationId
   ```
3. Создай DNS A-запись в CloudFlare:
   ```bash
   bash scripts/cloudflare-dns.sh create <full-domain> <server-ip>
   ```
4. Добавь домен в Dokploy:
   ```bash
   bash scripts/dokploy-api.sh <server> POST domain.create '{
     "applicationId": "<id>",
     "host": "<full-domain>",
     "port": <port-or-3000>,
     "https": true,
     "path": "/",
     "certificateType": "letsencrypt"
   }'
   ```
5. Подожди 30 секунд (DNS propagation)
6. Проверь доступность:
   ```bash
   bash scripts/wait-ready.sh https://<full-domain> 120
   ```

#### `domain remove <full-domain>`

1. Найди domainId через Dokploy API
2. Удали из Dokploy:
   ```bash
   bash scripts/dokploy-api.sh <server> DELETE domain.delete '{"domainId":"<id>"}'
   ```
3. Удали DNS-запись из CloudFlare:
   ```bash
   bash scripts/cloudflare-dns.sh delete <full-domain>
   ```

#### `domain list [--server <name>]`

Покажи все домены на сервере:
```bash
bash scripts/dokploy-api.sh <server> GET project.all
# Распарси JSON, покажи таблицу: Project | Application | Domain | HTTPS
```

---

### `/vps db` — Управление базами данных

**Подкоманды:**

#### `db create <type> <name> [--project <project-name>]`

Поддерживаемые типы: `postgres`, `mysql`, `mariadb`, `mongo`, `redis`

1. Если указан `--project`, найди projectId, иначе попроси указать
2. Создай БД через Dokploy API:
   ```bash
   bash scripts/dokploy-api.sh <server> POST <type>.create '{
     "name": "<name>",
     "projectId": "<id>",
     "databasePassword": "<auto-generated-password>"
   }'
   ```
3. Деплой БД:
   ```bash
   bash scripts/dokploy-api.sh <server> POST <type>.deploy '{"<type>Id":"<id>"}'
   ```
4. Получи connection string:
   ```bash
   bash scripts/dokploy-api.sh <server> GET <type>.one '{"<type>Id":"<id>"}'
   ```
5. Покажи пользователю:
   - Internal connection string (для приложений на том же сервере)
   - External connection string (для локального доступа)

#### `db list [--server <name>]`

Покажи все БД на сервере.

#### `db delete <name>`

Удали БД (после подтверждения).

---

### `/vps status` — Статус сервера и проектов

**Аргументы:** `[--server <name>]`

Шаги:
1. Получи список всех проектов:
   ```bash
   bash scripts/dokploy-api.sh <server> GET project.all
   ```
2. Для каждого приложения проверь статус (running/stopped)
3. Получи ресурсы сервера через SSH:
   ```bash
   bash scripts/ssh-exec.sh <server> "
     echo 'CPU:' && top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | cut -d'%' -f1
     echo 'RAM:' && free -h | grep Mem | awk '{print \$3\"/\"\$2}'
     echo 'Disk:' && df -h / | tail -1 | awk '{print \$3\"/\"\$2 \" (\" \$5 \" used)\"}'
   "
   ```
4. Покажи таблицу:
   ```
   Сервер: main (45.55.67.89)
   CPU: 23%  RAM: 1.2/4 GB  Disk: 18/80 GB

   Проекты:
   ┌─────────────────┬──────────┬─────────────────────────┬────────┐
   │ Проект          │ Статус   │ Домен                   │ Порт   │
   ├─────────────────┼──────────┼─────────────────────────┼────────┤
   │ my-nextjs-app   │ ● Running│ app.example.com         │ 3000   │
   │ api-service     │ ● Running│ api.example.com         │ 8080   │
   └─────────────────┴──────────┴─────────────────────────┴────────┘
   ```

---

### `/vps logs` — Просмотр логов

**Синтаксис:** `logs <project-name> [--lines <n>] [--build] [--follow]`

#### Runtime-логи (без --build)

```bash
bash scripts/ssh-exec.sh <server> "docker service logs <service-name> --tail <n-or-100>"
```

#### Build-логи (с --build)

1. Найди последний deploymentId:
   ```bash
   bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<appId>"
   ```
2. Получи логи:
   ```bash
   bash scripts/dokploy-api.sh <server> GET "deployment.logsByDeployment?deploymentId=<id>"
   ```

---

### `/vps backup` — Управление бэкапами БД

**Подкоманды:**

#### `backup create <db-name> [--type <postgres|mysql|mongo|redis>]`

1. Определи тип БД и имя контейнера из Dokploy API
2. Выполни бэкап:
   ```bash
   bash scripts/backup.sh create <server> <db-type> <container-name>
   ```
3. Покажи результат:
   ```
   Бэкап создан
   Файл: /backups/my-app-db-20260223_143000.sql.gz
   Размер: 12.5 MB
   Тип: PostgreSQL
   ```

#### `backup restore <db-name> [--file <path>]`

1. Если `--file` не указан, покажи список доступных бэкапов:
   ```bash
   bash scripts/backup.sh list <server>
   ```
2. **ОБЯЗАТЕЛЬНО** попроси подтверждение (это деструктивная операция!)
3. Выполни восстановление:
   ```bash
   bash scripts/backup.sh restore <server> <db-type> <container-name> <backup-file>
   ```

#### `backup list [--server <name>]`

```bash
bash scripts/backup.sh list <server>
```

#### `backup cleanup [--keep <n>]`

Удали старые бэкапы, оставив последние N (по умолчанию 5):
```bash
bash scripts/backup.sh cleanup <server> /backups <n>
```

---

### `/vps rollback` — Откат на предыдущий деплой

**Синтаксис:** `rollback <project-name> [--to <deployment-id>]`

Шаги:
1. Получи историю деплоев приложения:
   ```bash
   bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=<appId>"
   ```
2. Покажи список последних 5 деплоев:
   ```
   История деплоев my-app:
   ┌────┬────────────────────┬──────────┬───────────────────────┐
   │ #  │ ID                 │ Статус   │ Дата                  │
   ├────┼────────────────────┼──────────┼───────────────────────┤
   │ 1  │ dep_abc123 (текущ.)│ done     │ 2026-02-23 14:30      │
   │ 2  │ dep_def456         │ done     │ 2026-02-22 11:00      │
   │ 3  │ dep_ghi789         │ error    │ 2026-02-21 09:15      │
   └────┴────────────────────┴──────────┴───────────────────────┘
   ```
3. Если `--to` не указан, спроси: "Откатить на деплой #2 (dep_def456)?"
4. Перед откатом создай автоматический бэкап БД (если `auto_backup_before_destroy` в settings):
   ```bash
   bash scripts/backup.sh create <server> <db-type> <container-name>
   ```
5. Выполни ре-деплой через обновление ветки/коммита и повторный deploy
6. Мониторь статус деплоя (как в deploy-guide.md)
7. Покажи итог

---

### `/vps health` — Проверка здоровья

**Подкоманды:**

#### `health` или `health server [--server <name>]`

Полная проверка сервера:
```bash
bash scripts/health-check.sh server <server>
```

Покажи красиво с прогресс-барами и статусами.

#### `health app <project-name>`

Проверка здоровья конкретного приложения:
```bash
bash scripts/health-check.sh app <server> <app-name>
```

#### `health docker [--server <name>]`

Docker-специфичная проверка:
```bash
bash scripts/health-check.sh docker <server>
```

#### `health disk [--server <name>]`

Анализ использования диска:
```bash
bash scripts/health-check.sh disk <server>
```

#### `health ssl <domain>`

Проверка SSL-сертификата:
```bash
bash scripts/health-check.sh ssl <domain>
```

---

### `/vps env` — Управление переменными окружения

**Подкоманды:**

#### `env list <app-name> [--server <name>]`

Показать переменные окружения приложения (секреты маскируются):
```bash
bash scripts/env-manager.sh list <server> <app-name>
```

#### `env get <app-name> <key>`

Получить значение конкретной переменной:
```bash
bash scripts/env-manager.sh get <server> <app-name> <key>
```

#### `env set <app-name> <key> <value>`

Установить переменную окружения (с записью в audit log):
```bash
bash scripts/env-manager.sh set <server> <app-name> <key> <value>
```
После установки спроси, нужен ли ре-деплой для применения изменений.

#### `env delete <app-name> <key>`

Удалить переменную (с подтверждением):
```bash
bash scripts/env-manager.sh delete <server> <app-name> <key>
```

#### `env diff <app1> <app2>`

Сравнить переменные двух приложений:
```bash
bash scripts/env-manager.sh diff <server> <app1> <app2>
```

#### `env export <app-name> [--file <path>]`

Экспортировать переменные в .env файл:
```bash
bash scripts/env-manager.sh export <server> <app-name> [file]
```

#### `env import <app-name> <file>`

Импортировать переменные из .env файла:
```bash
bash scripts/env-manager.sh import <server> <app-name> <file>
```

#### `env audit [--app <name>]`

Показать историю изменений переменных:
```bash
bash scripts/env-manager.sh audit <server> [app-name]
```

---

### `/vps monitor` — Мониторинг (Prometheus + Grafana)

**Подкоманды:**

#### `monitor enable [--server <name>]`

Развернуть стек мониторинга (Prometheus + Grafana + Alertmanager + node_exporter + cAdvisor):
```bash
bash scripts/monitor.sh enable <server>
```
После установки покажи URL-адреса: Grafana (порт 3001), Prometheus (порт 9090), Alertmanager (порт 9093).

#### `monitor disable [--server <name>]`

Остановить и удалить стек мониторинга:
```bash
bash scripts/monitor.sh disable <server>
```
**Проси подтверждение перед удалением!**

#### `monitor status [--server <name>]`

Статус всех компонентов мониторинга:
```bash
bash scripts/monitor.sh status <server>
```

#### `monitor alert <webhook-url> [--server <name>]`

Настроить webhook для уведомлений от Alertmanager:
```bash
bash scripts/monitor.sh alert <server> <webhook-url>
```

#### `monitor query <promql> [--server <name>]`

Выполнить PromQL-запрос:
```bash
bash scripts/monitor.sh query <server> "<promql>"
```

#### `monitor dashboard [--server <name>]`

Показать текущие метрики (CPU, RAM, диск, контейнеры):
```bash
bash scripts/monitor.sh dashboard <server>
```

---

### `/vps security` — Аудит безопасности

**Подкоманды:**

#### `security` или `security server [--server <name>]`

Полный аудит безопасности сервера (SSH, firewall, fail2ban, updates, Docker):
```bash
bash scripts/security-scan.sh server <server>
```
Покажи результат с оценкой и рекомендациями.

#### `security deps [--path <dir>]`

Аудит зависимостей проекта (npm audit, pip-audit, bundler-audit):
```bash
bash scripts/security-scan.sh deps <server> [path]
```

#### `security ports [--server <name>]`

Сканирование открытых портов (внешних и внутренних):
```bash
bash scripts/security-scan.sh ports <server>
```

#### `security docker [--server <name>]`

Проверка безопасности Docker (привилегированные контейнеры, устаревшие образы):
```bash
bash scripts/security-scan.sh docker <server>
```

#### `security ssh [--server <name>]`

Проверка hardening SSH:
```bash
bash scripts/security-scan.sh ssh <server>
```

#### `security ssl <domain>`

Проверка TLS-конфигурации и security headers:
```bash
bash scripts/security-scan.sh ssl <domain>
```

---

### `/vps cron` — Управление cron-задачами

**Подкоманды:**

#### `cron list [--server <name>]`

Список всех управляемых cron-задач:
```bash
bash scripts/cron-manager.sh list <server>
```

#### `cron add <name> <schedule> <command> [--server <name>]`

Добавить cron-задачу с автоматическим логированием:
```bash
bash scripts/cron-manager.sh add <server> <name> "<schedule>" "<command>"
```
Примеры расписания: `"0 2 * * *"` (каждый день в 2:00), `"*/5 * * * *"` (каждые 5 минут).

#### `cron remove <name> [--server <name>]`

Удалить cron-задачу:
```bash
bash scripts/cron-manager.sh remove <server> <name>
```

#### `cron logs <name> [--lines <n>] [--server <name>]`

Просмотр логов cron-задачи:
```bash
bash scripts/cron-manager.sh logs <server> <name> [lines]
```

#### `cron run <name> [--server <name>]`

Запустить задачу немедленно (вне расписания):
```bash
bash scripts/cron-manager.sh run <server> <name>
```

#### `cron status [--server <name>]`

Статус всех задач (последний запуск, следующий запуск, ошибки):
```bash
bash scripts/cron-manager.sh status <server>
```

---

### `/vps template` — Деплой из шаблонов

**Подкоманды:**

#### `template list`

Покажи список доступных шаблонов:
```bash
# Прочитай файлы из templates/apps/*.yml
# Покажи список: название, описание (из комментария в первой строке), usage
```

Доступные шаблоны:
| Шаблон | Описание |
|:-------|:---------|
| `wordpress` | WordPress + MySQL |
| `ghost` | Ghost — современная платформа для блога |
| `plausible` | Plausible Analytics — приватная аналитика |
| `uptime-kuma` | Uptime Kuma — мониторинг доступности |
| `n8n` | n8n — автоматизация workflow (как Zapier) |

#### `template deploy <name> --domain <domain> [--server <name>]`

1. Прочитай шаблон из `templates/apps/<name>.yml`
2. Сгенерируй необходимые секреты:
   - `DB_PASSWORD`: `openssl rand -hex 16`
   - `SECRET_KEY`: `openssl rand -hex 32`
   - `DB_ROOT_PASSWORD`: `openssl rand -hex 16` (если требуется)
3. Создай DNS-запись:
   ```bash
   bash scripts/cloudflare-dns.sh create <domain> <server-ip>
   ```
4. Подставь переменные в шаблон (`${DOMAIN}`, `${DB_PASSWORD}`, `${SECRET_KEY}`)
5. Загрузи docker-compose на сервер через SSH:
   ```bash
   bash scripts/ssh-exec.sh --upload <server> <local-path> /opt/apps/<name>/docker-compose.yml
   ```
6. Запусти:
   ```bash
   bash scripts/ssh-exec.sh <server> "cd /opt/apps/<name> && docker compose up -d"
   ```
7. Дождись готовности:
   ```bash
   bash scripts/wait-ready.sh https://<domain> 120
   ```
8. Покажи результат с URL и credentials

#### `template info <name>`

Покажи подробную информацию о шаблоне: компоненты, ресурсы, переменные.

---

### `/vps notify` — Уведомления

**Подкоманды:**

#### `notify test [--server <name>]`

Отправить тестовое уведомление во все настроенные каналы:
```bash
bash scripts/notify.sh test
```

#### `notify send <message> [--level <info|success|warning|error>]`

Отправить сообщение во все настроенные каналы:
```bash
bash scripts/notify.sh send "<message>" [level]
```

#### `notify slack <webhook-url>`

Настроить Slack webhook в конфиге:
```json
{
  "notifications": {
    "slack_webhook": "<webhook-url>"
  }
}
```

#### `notify telegram <bot-token> <chat-id>`

Настроить Telegram бота в конфиге:
```json
{
  "notifications": {
    "telegram_bot_token": "<bot-token>",
    "telegram_chat_id": "<chat-id>"
  }
}
```

#### `notify discord <webhook-url>`

Настроить Discord webhook в конфиге:
```json
{
  "notifications": {
    "discord_webhook": "<webhook-url>"
  }
}
```

---

### `/vps db-analyze` — Анализ производительности БД

**Подкоманды:**

#### `db-analyze stats <db-name> [--server <name>]`

Статистика БД (размер, подключения, uptime):
```bash
bash scripts/db-analyze.sh stats <server> <db-type> <container-name>
```

#### `db-analyze slowlog <db-name> [--top <n>]`

Топ медленных запросов (через pg_stat_statements / slow_log):
```bash
bash scripts/db-analyze.sh slowlog <server> <db-type> <container-name> [n]
```

#### `db-analyze indexes <db-name>`

Анализ индексов (неиспользуемые, дублирующиеся, отсутствующие):
```bash
bash scripts/db-analyze.sh indexes <server> <db-type> <container-name>
```

#### `db-analyze tables <db-name>`

Размеры таблиц и bloat:
```bash
bash scripts/db-analyze.sh tables <server> <db-type> <container-name>
```

#### `db-analyze connections <db-name>`

Активные подключения и текущие запросы:
```bash
bash scripts/db-analyze.sh connections <server> <db-type> <container-name>
```

---

### `/vps validate` — Валидация деплоя

**Подкоманды:**

#### `validate <url> [--server <name>]`

Проверка health endpoint после деплоя:
```bash
bash scripts/deploy-validator.sh validate <server> <url>
```

#### `validate smoke <url> [--endpoints /api,/health,/]`

Smoke-тесты нескольких эндпоинтов:
```bash
bash scripts/deploy-validator.sh smoke <server> <url> [endpoints]
```

#### `validate gate <url> [--max-latency <ms>] [--max-errors <n>]`

Deployment gate (проверка latency и error rate):
```bash
bash scripts/deploy-validator.sh gate <server> <url> [max-latency] [max-errors]
```
Поддерживает `--auto-rollback` для автоматического отката при провале.

---

### `/vps destroy` — Удаление проекта

**Синтаксис:** `destroy <project-name> [--keep-db] [--keep-dns]`

**ВСЕГДА** проси подтверждение перед удалением!

Шаги:
1. Найди проект и все связанные ресурсы (приложения, БД, домены)
2. Покажи пользователю что будет удалено
3. Дождись подтверждения
4. Если `auto_backup_before_destroy` включён в settings, создай бэкап БД:
   ```bash
   bash scripts/backup.sh create <server> <db-type> <container-name>
   ```
5. Если подтверждено:
   - Останови приложение:
     ```bash
     bash scripts/dokploy-api.sh <server> POST application.stop '{"applicationId":"<id>"}'
     ```
   - Удали приложение:
     ```bash
     bash scripts/dokploy-api.sh <server> DELETE application.delete '{"applicationId":"<id>"}'
     ```
   - Если не `--keep-db`, удали БД:
     ```bash
     bash scripts/dokploy-api.sh <server> DELETE postgres.remove '{"postgresId":"<id>"}'
     ```
   - Если не `--keep-dns`, удали DNS:
     ```bash
     bash scripts/cloudflare-dns.sh delete <domain>
     ```
   - Удали проект:
     ```bash
     bash scripts/dokploy-api.sh <server> DELETE project.remove '{"projectId":"<id>"}'
     ```
6. Покажи отчёт об удалённых ресурсах и путь к бэкапу (если был создан)

---

## Команды со сложной логикой (используют reference guides)

### `/vps setup` — Настройка VPS с нуля

Эта команда требует детальных инструкций. Прочитай и следуй:
```
references/setup-guide.md
```

### `/vps deploy` — Деплой проекта из GitHub

Эта команда требует трёхфазного процесса (анализ → уточнение → деплой). Прочитай и следуй:
```
references/deploy-guide.md
references/stack-detection.md
references/dokploy-api-reference.md (опционально, для справки по API)
```

### Детальное описание v3-фич

Для подробной информации о всех v3-возможностях (env, monitor, security, cron, template, notify, db-analyze, validate) прочитай:
```
references/v3-features-guide.md
```

---

## Справка (когда $ARGUMENTS пусто)

Покажи:

```
VPS Ninja v3 — автоматизация VPS через Dokploy

Основные команды:

  /vps setup <ip> <password>              Настроить VPS с нуля (установить Dokploy)
  /vps deploy <github-url> [--domain D]   Задеплоить проект из GitHub
  /vps status [--server <name>]           Статус сервера и проектов

Управление:

  /vps domain add <domain> <project>      Добавить домен к проекту
  /vps domain remove <domain>             Удалить домен
  /vps domain list                        Список всех доменов
  /vps db create <type> <name>            Создать БД (postgres/mysql/mongo/redis)
  /vps db list                            Список всех БД
  /vps db delete <name>                   Удалить БД
  /vps logs <project> [--build]           Логи приложения или билда

Переменные окружения:

  /vps env list <app>                     Список переменных (секреты скрыты)
  /vps env set <app> <key> <value>        Установить переменную
  /vps env diff <app1> <app2>             Сравнить переменные двух приложений
  /vps env export <app>                   Экспорт в .env файл
  /vps env import <app> <file>            Импорт из .env файла
  /vps env audit                          История изменений

Мониторинг и безопасность:

  /vps health [server|app|docker|disk]    Проверка здоровья
  /vps health ssl <domain>               Проверить SSL-сертификат
  /vps monitor enable                     Установить Prometheus + Grafana
  /vps monitor status                     Статус мониторинга
  /vps monitor dashboard                  Текущие метрики
  /vps monitor query <promql>             PromQL-запрос
  /vps security                           Полный аудит безопасности
  /vps security deps                      Аудит зависимостей
  /vps security ports                     Сканирование портов
  /vps security docker                    Проверка Docker-безопасности
  /vps security ssl <domain>              Проверка TLS и headers

Бэкапы и откаты:

  /vps backup create <db-name>            Создать бэкап БД
  /vps backup restore <db-name>           Восстановить из бэкапа
  /vps backup list                        Список бэкапов
  /vps backup cleanup [--keep N]          Ротация старых бэкапов
  /vps rollback <project>                 Откатить на предыдущий деплой

Анализ БД:

  /vps db-analyze stats <db>              Статистика БД
  /vps db-analyze slowlog <db>            Топ медленных запросов
  /vps db-analyze indexes <db>            Анализ индексов
  /vps db-analyze tables <db>             Размеры таблиц
  /vps db-analyze connections <db>        Активные подключения

Шаблоны приложений:

  /vps template list                      Доступные шаблоны
  /vps template deploy <name> --domain D  Развернуть WordPress, Ghost, n8n и др.
  /vps template info <name>               Информация о шаблоне

Cron-задачи:

  /vps cron list                          Список задач
  /vps cron add <name> <schedule> <cmd>   Добавить задачу
  /vps cron remove <name>                 Удалить задачу
  /vps cron logs <name>                   Логи задачи
  /vps cron run <name>                    Запустить вручную

Уведомления:

  /vps notify test                        Тестовое уведомление
  /vps notify send <message>              Отправить сообщение
  /vps notify slack <webhook>             Настроить Slack
  /vps notify telegram <token> <chat>     Настроить Telegram
  /vps notify discord <webhook>           Настроить Discord

Валидация деплоя:

  /vps validate <url>                     Health-check после деплоя
  /vps validate smoke <url>               Smoke-тесты эндпоинтов
  /vps validate gate <url>                Deployment gate (latency/errors)

Прочее:

  /vps destroy <project>                  Удалить проект (с авто-бэкапом)
  /vps config                             Показать конфигурацию
  /vps config server add <name> <ip>      Добавить сервер
  /vps config cloudflare <token>          Настроить CloudFlare API
  /vps config settings [key] [value]      Управление настройками

Флаги:
  --debug                                Детальный вывод для отладки
  --server <name>                        Указать сервер (иначе — default)

Примеры:

  /vps setup 45.55.67.89 MyPassword123
  /vps deploy github.com/user/my-app --domain app.example.com
  /vps template deploy wordpress --domain blog.example.com
  /vps env set my-app DATABASE_URL postgres://...
  /vps monitor enable
  /vps security
  /vps cron add backup "0 2 * * *" "docker exec db pg_dump > /backups/db.sql"
  /vps notify slack https://hooks.slack.com/...
  /vps db-analyze slowlog my-db --top 10
  /vps validate smoke https://app.example.com
```
