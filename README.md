# VPS Ninja v3

**Claude Code skill для полной автоматизации VPS через Dokploy**

Деплой приложений на VPS одной командой — без DevOps-опыта. Мониторинг, безопасность, шаблоны, уведомления — из коробки.

---

## Что нового в v3

- **Environment Manager** — управление переменными окружения с audit trail, diff, import/export
- **Prometheus + Grafana** — полный стек мониторинга одной командой (+ Alertmanager, node_exporter, cAdvisor)
- **Security Audit** — проверка SSH, firewall, портов, Docker, TLS, security headers, зависимостей
- **Cron Manager** — управление cron-задачами с логированием и метаданными
- **App Templates** — WordPress, Ghost, Plausible, Uptime Kuma, n8n одной командой
- **Notifications** — Slack, Telegram, Discord webhook-уведомления
- **DB Analyzer** — анализ медленных запросов, индексов, размеров таблиц, подключений
- **Deploy Validation** — health-check, smoke-тесты, deployment gates с auto-rollback
- **7 новых скриптов**, **5 шаблонов приложений**, **30+ новых команд**

### v2 (включено)

- Shared Library (`common.sh`) — логирование, ошибки, retry, валидация
- Smart Retry — GET ретраится, POST/DELETE — никогда
- Multi-TLD — поддержка `.co.uk`, `.com.br` и 40+ TLD
- Security Fixes — SSH injection protection, таймауты
- Backup/Restore — PostgreSQL, MySQL, MongoDB, Redis
- Rollback — откат деплоя с автобэкапом
- Health Monitoring — CPU, RAM, диск, Docker, SSL

---

## Возможности

### Ядро
- **Setup VPS** — настрой чистый сервер за 5 минут (Dokploy + firewall + swap + fail2ban)
- **Auto Deploy** — автоопределение стека (Next.js, Django, FastAPI, Go, Rust, Docker...)
- **DNS Management** — CloudFlare DNS + SSL сертификаты
- **Database Management** — PostgreSQL, MySQL, MongoDB, Redis одной командой
- **Backup/Restore** — бэкапы БД с ротацией

### v3 Фичи
- **Env Manager** — set/get/diff/export/import/audit переменных окружения
- **Monitoring** — Prometheus + Grafana + Alertmanager + PromQL запросы
- **Security** — полный аудит сервера, Docker, портов, зависимостей, TLS
- **Cron** — управление задачами с логированием
- **Templates** — WordPress, Ghost, Plausible, Uptime Kuma, n8n
- **Notifications** — Slack, Telegram, Discord
- **DB Analysis** — slow queries, indexes, table sizes, connections
- **Deploy Validation** — health-checks, smoke-тесты, deployment gates

---

## Все команды

### Основные

| Команда | Описание |
|:--------|:---------|
| `/vps setup <ip> <password>` | Настроить VPS с нуля |
| `/vps deploy <github-url> [--domain D]` | Деплой проекта из GitHub |
| `/vps status [--server <name>]` | Статус сервера и проектов |

### Домены и БД

| Команда | Описание |
|:--------|:---------|
| `/vps domain add <domain> <project>` | Добавить домен к проекту |
| `/vps domain remove <domain>` | Удалить домен |
| `/vps domain list` | Список всех доменов |
| `/vps db create <type> <name>` | Создать БД (postgres/mysql/mongo/redis) |
| `/vps db list` | Список всех БД |
| `/vps db delete <name>` | Удалить БД |
| `/vps logs <project> [--build]` | Логи приложения или билда |

### Переменные окружения (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps env list <app>` | Список переменных (секреты скрыты) |
| `/vps env set <app> <key> <value>` | Установить переменную |
| `/vps env get <app> <key>` | Получить значение |
| `/vps env delete <app> <key>` | Удалить переменную |
| `/vps env diff <app1> <app2>` | Сравнить переменные двух приложений |
| `/vps env export <app>` | Экспорт в .env файл |
| `/vps env import <app> <file>` | Импорт из .env файла |
| `/vps env audit` | История изменений |

### Мониторинг (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps health [server\|app\|docker\|disk]` | Проверка здоровья |
| `/vps health ssl <domain>` | Проверить SSL-сертификат |
| `/vps monitor enable` | Установить Prometheus + Grafana |
| `/vps monitor disable` | Удалить стек мониторинга |
| `/vps monitor status` | Статус компонентов мониторинга |
| `/vps monitor dashboard` | Текущие метрики |
| `/vps monitor query <promql>` | PromQL-запрос |
| `/vps monitor alert <webhook>` | Настроить webhook для алертов |

### Безопасность (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps security` | Полный аудит безопасности сервера |
| `/vps security deps` | Аудит зависимостей (npm/pip/bundler) |
| `/vps security ports` | Сканирование открытых портов |
| `/vps security docker` | Проверка Docker-безопасности |
| `/vps security ssh` | Проверка SSH hardening |
| `/vps security ssl <domain>` | TLS и security headers |

### Бэкапы и откаты

| Команда | Описание |
|:--------|:---------|
| `/vps backup create <db-name>` | Создать бэкап БД |
| `/vps backup restore <db-name>` | Восстановить из бэкапа |
| `/vps backup list` | Список бэкапов |
| `/vps backup cleanup [--keep N]` | Ротация старых бэкапов |
| `/vps rollback <project>` | Откатить на предыдущий деплой |

### Анализ БД (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps db-analyze stats <db>` | Статистика БД |
| `/vps db-analyze slowlog <db>` | Топ медленных запросов |
| `/vps db-analyze indexes <db>` | Анализ индексов |
| `/vps db-analyze tables <db>` | Размеры таблиц |
| `/vps db-analyze connections <db>` | Активные подключения |

### Шаблоны приложений (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps template list` | Доступные шаблоны |
| `/vps template deploy <name> --domain D` | Развернуть приложение из шаблона |
| `/vps template info <name>` | Информация о шаблоне |

Доступные шаблоны: **WordPress**, **Ghost**, **Plausible Analytics**, **Uptime Kuma**, **n8n**

### Cron-задачи (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps cron list` | Список задач |
| `/vps cron add <name> <schedule> <cmd>` | Добавить задачу |
| `/vps cron remove <name>` | Удалить задачу |
| `/vps cron logs <name>` | Логи задачи |
| `/vps cron run <name>` | Запустить вручную |
| `/vps cron status` | Статус всех задач |

### Уведомления (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps notify test` | Тестовое уведомление |
| `/vps notify send <msg>` | Отправить сообщение |
| `/vps notify slack <webhook>` | Настроить Slack |
| `/vps notify telegram <token> <chat>` | Настроить Telegram |
| `/vps notify discord <webhook>` | Настроить Discord |

### Валидация деплоя (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps validate <url>` | Health-check после деплоя |
| `/vps validate smoke <url>` | Smoke-тесты эндпоинтов |
| `/vps validate gate <url>` | Deployment gate (latency/errors) |

### Конфигурация

| Команда | Описание |
|:--------|:---------|
| `/vps config` | Показать конфигурацию |
| `/vps config server add <name> <ip>` | Добавить сервер в конфиг |
| `/vps config cloudflare <token>` | Настроить CloudFlare API |
| `/vps config settings [key] [value]` | Управление настройками |
| `/vps destroy <project>` | Удалить проект (с авто-бэкапом) |

---

## Быстрый старт

### 1. Установка

```bash
git clone https://github.com/kyzdes/vps-ninja-bot.git
cd vps-ninja-bot
cp -r skill ~/.claude/skills/vps
```

### 2. Зависимости

```bash
# macOS
brew install jq sshpass

# Linux (Ubuntu/Debian)
sudo apt install jq sshpass
```

### 3. Настройка VPS

```bash
/vps setup 45.55.67.89 your-root-password
```

### 4. Деплой проекта

```bash
/vps deploy github.com/user/my-app --domain app.example.com
```

### 5. Или разверни готовое приложение

```bash
/vps template deploy wordpress --domain blog.example.com
```

### 6. Включи мониторинг и безопасность

```bash
/vps monitor enable
/vps security
/vps notify slack https://hooks.slack.com/services/...
```

---

## Архитектура v3

```
skill/
├── SKILL.md                        # Маршрутизатор (~800 строк)
├── scripts/
│   ├── common.sh                   # Shared library: logging, errors, retry, validation
│   ├── dokploy-api.sh              # Dokploy API — smart retry, response validation
│   ├── cloudflare-dns.sh           # CloudFlare DNS — multi-TLD, rate limiting, upsert
│   ├── ssh-exec.sh                 # SSH — injection protection, timeouts, upload
│   ├── wait-ready.sh               # URL checker — progress output
│   ├── backup.sh                   # DB backup: create, restore, list, cleanup
│   ├── health-check.sh             # Health: server, app, docker, disk, ssl
│   ├── deploy-validator.sh  (NEW)  # Post-deploy: validate, smoke, gate
│   ├── notify.sh            (NEW)  # Notifications: Slack, Telegram, Discord
│   ├── env-manager.sh       (NEW)  # Env vars: list, set, diff, export, audit
│   ├── monitor.sh           (NEW)  # Prometheus + Grafana + Alertmanager
│   ├── db-analyze.sh        (NEW)  # DB: slow queries, indexes, tables
│   ├── cron-manager.sh      (NEW)  # Cron: add, remove, logs, status
│   └── security-scan.sh     (NEW)  # Security: server, deps, ports, docker, ssh, ssl
├── templates/
│   ├── setup-server.sh             # Idempotent VPS setup script
│   └── apps/                (NEW)
│       ├── wordpress.yml           # WordPress + MySQL
│       ├── ghost.yml               # Ghost + MySQL
│       ├── plausible.yml           # Plausible Analytics + PostgreSQL + ClickHouse
│       ├── uptime-kuma.yml         # Uptime Kuma monitoring
│       └── n8n.yml                 # n8n workflow automation + PostgreSQL
├── references/
│   ├── setup-guide.md              # Setup procedure
│   ├── deploy-guide.md             # 3-phase deploy
│   ├── stack-detection.md          # Stack detection rules
│   ├── dokploy-api-reference.md    # API reference
│   ├── backup-guide.md             # Backup/restore guide
│   ├── rollback-guide.md           # Rollback procedure
│   └── v3-features-guide.md (NEW)  # Comprehensive v3 features guide
├── config/
│   ├── .gitignore
│   └── servers.json.example        # Config template with settings
└── README.md
```

### Ключевые принципы

1. **DRY** — `common.sh` устраняет дублирование
2. **Security** — SSH injection protection, secret masking, audit trail
3. **Idempotency** — все операции безопасно повторяемы
4. **Smart Retry** — GET ретраится, POST/DELETE — нет
5. **Multi-TLD** — 40+ TLD в DNS (.co.uk, .com.br, etc.)
6. **Observability** — Prometheus/Grafana, debug mode, structured logging
7. **Safety Net** — автобэкапы, deployment gates, auto-rollback
8. **Notifications** — оповещения о событиях в Slack/Telegram/Discord

---

## Конфигурация

```json
{
  "servers": {
    "main": {
      "host": "45.55.67.89",
      "ssh_user": "root",
      "ssh_key": "",
      "dokploy_url": "http://45.55.67.89:3000",
      "dokploy_api_key": "dk_..."
    }
  },
  "cloudflare": {
    "api_token": "cf_..."
  },
  "defaults": {
    "server": "main"
  },
  "settings": {
    "timeout_api": 30,
    "timeout_ssh": 600,
    "timeout_deploy": 600,
    "backup_dir": "/backups",
    "backup_keep": 5,
    "auto_backup_before_destroy": true
  },
  "notifications": {
    "slack_webhook": "https://hooks.slack.com/...",
    "telegram_bot_token": "123:ABC...",
    "telegram_chat_id": "-100123...",
    "discord_webhook": "https://discord.com/api/webhooks/..."
  }
}
```

### Настройки

| Ключ | Описание | По умолчанию |
|:-----|:---------|:-------------|
| `timeout_api` | Таймаут API-запросов (сек) | 30 |
| `timeout_ssh` | Таймаут SSH-команд (сек) | 600 |
| `timeout_deploy` | Таймаут ожидания деплоя (сек) | 600 |
| `backup_dir` | Директория для бэкапов на сервере | `/backups` |
| `backup_keep` | Количество хранимых бэкапов | 5 |
| `auto_backup_before_destroy` | Автобэкап перед удалением | `true` |

---

## Поддерживаемые стеки

- **Node.js**: Next.js, Nuxt, NestJS, Express, Remix, Vite, Angular, Gatsby
- **Python**: Django, FastAPI, Flask
- **Go**: Любые Go-приложения
- **Rust**: Любые Rust-приложения
- **Ruby**: Ruby on Rails, Sinatra
- **Java**: Spring Boot, Maven, Gradle
- **.NET**: ASP.NET Core
- **PHP**: Laravel, Symfony
- **Docker**: Dockerfile или docker-compose.yml

---

## Безопасность

- `config/servers.json` никогда не коммитится (gitignored)
- API-ключи и пароли маскируются в ответах Claude
- SSH-команды защищены от инъекций через `--` separator
- Деструктивные операции требуют подтверждения
- Автобэкапы перед удалением и откатом
- Audit trail для изменений переменных окружения
- Security scanning для сервера, Docker, портов, зависимостей
- POST/DELETE запросы не ретраятся (защита от дубликатов)

---

## Contributing

Pull requests welcome!

```bash
git checkout -b feature/amazing-feature
git commit -m 'Add amazing feature'
git push origin feature/amazing-feature
```

---

## Статистика v3

- **24 файла** в skill (+7 скриптов, +5 шаблонов, +1 гайд vs v2)
- **~6000+ строк** кода
- **20+ стеков** поддерживаются
- **50+ команд** (было 11 в v2)
- **8 API интеграций** (Dokploy, CloudFlare, SSH, Git, Prometheus, Slack, Telegram, Discord)
- **40+ TLD** поддерживаются в DNS
- **5 шаблонов** готовых приложений

---

## Лицензия

MIT License

---

**Сделано для Claude Code community**
