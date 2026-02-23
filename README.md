# VPS Ninja v2

**Claude Code skill для автоматизации VPS через Dokploy**

Деплой приложений на VPS одной командой — без DevOps-опыта. Бэкапы, откаты, мониторинг — из коробки.

---

## Что нового в v2

- **Shared Library** (`common.sh`) — единая система логирования, ошибок, retry, валидации
- **Smart Retry** — GET-запросы ретраятся автоматически, POST/DELETE — никогда (защита от дубликатов)
- **Multi-TLD** — поддержка `.co.uk`, `.com.br` и 40+ TLD в CloudFlare DNS
- **Security Fixes** — защита от SSH command injection, таймауты, sanitization
- **Backup/Restore** — бэкапы PostgreSQL, MySQL, MongoDB, Redis одной командой
- **Rollback** — откат на предыдущий деплой с автоматическим бэкапом БД
- **Health Monitoring** — проверка CPU, RAM, диска, Docker, SSL-сертификатов
- **Idempotent Setup** — скрипт настройки VPS можно запускать повторно безопасно
- **Progress Output** — красивый вывод прогресса для всех долгих операций
- **Configurable Settings** — таймауты, пути, ротация бэкапов через конфиг

---

## Возможности

- **Setup VPS** — настрой чистый сервер за 5 минут (Dokploy + firewall + swap + fail2ban)
- **Auto Deploy** — автоопределение стека (Next.js, Django, FastAPI, Go, Rust, Docker...)
- **DNS Management** — автоматическое создание CloudFlare DNS + SSL сертификатов
- **Database Management** — PostgreSQL, MySQL, MongoDB, Redis одной командой
- **Backup/Restore** — бэкапы БД с ротацией и автоматическим созданием перед удалением
- **Rollback** — откат на любой предыдущий деплой с безопасным бэкапом
- **Health Monitoring** — CPU, RAM, диск, Docker, SSL-сертификаты
- **Debug Mode** — детальный вывод для отладки (`--debug`)

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

### Мониторинг и безопасность (NEW)

| Команда | Описание |
|:--------|:---------|
| `/vps health` | Полная проверка здоровья сервера |
| `/vps health app <project>` | Здоровье конкретного приложения |
| `/vps health docker` | Статус Docker-контейнеров и ресурсов |
| `/vps health disk` | Анализ использования диска |
| `/vps health ssl <domain>` | Проверка SSL-сертификата (дни до истечения) |
| `/vps backup create <db-name>` | Создать бэкап БД |
| `/vps backup restore <db-name>` | Восстановить из бэкапа |
| `/vps backup list` | Список всех бэкапов |
| `/vps backup cleanup [--keep N]` | Ротация старых бэкапов |
| `/vps rollback <project>` | Откатить на предыдущий деплой |

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

### 5. Проверка здоровья

```bash
/vps health
```

---

## Архитектура v2

```
skill/
├── SKILL.md                        # Маршрутизатор (602 строки)
├── scripts/
│   ├── common.sh          (NEW)    # Shared library: logging, errors, retry, validation
│   ├── dokploy-api.sh     (REFACTORED) # Dokploy API — smart retry, response validation
│   ├── cloudflare-dns.sh  (REFACTORED) # CloudFlare DNS — multi-TLD, rate limiting, upsert
│   ├── ssh-exec.sh        (REFACTORED) # SSH — injection protection, timeouts, upload
│   ├── wait-ready.sh      (REFACTORED) # URL checker — progress output
│   ├── backup.sh          (NEW)    # DB backup: create, restore, list, cleanup
│   └── health-check.sh    (NEW)    # Health: server, app, docker, disk, ssl
├── templates/
│   └── setup-server.sh    (REFACTORED) # Idempotent setup, progress, system tuning
├── references/
│   ├── setup-guide.md              # Setup procedure
│   ├── deploy-guide.md             # 3-phase deploy
│   ├── stack-detection.md          # Stack detection rules
│   ├── dokploy-api-reference.md    # API reference
│   ├── backup-guide.md    (NEW)    # Backup/restore guide
│   └── rollback-guide.md  (NEW)    # Rollback procedure
├── config/
│   ├── .gitignore
│   └── servers.json.example (UPDATED) # + settings section
└── README.md
```

### Ключевые принципы v2

1. **DRY** — `common.sh` устраняет дублирование кода config/error/logging
2. **Security** — SSH injection protection, secret masking, `--` separator
3. **Idempotency** — все операции безопасно повторяемы
4. **Smart Retry** — только GET ретраится, POST/DELETE — нет
5. **Multi-TLD** — 40+ TLD поддерживаются в DNS (.co.uk, .com.br, etc.)
6. **Observability** — debug mode, structured logging, progress bars
7. **Safety Net** — автобэкапы перед destroy/rollback

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
- DNS-операции показывают предпросмотр изменений
- POST/DELETE запросы не ретраятся (защита от дубликатов)

---

## Документация

| Документ | Описание |
|:---------|:---------|
| [PRD.md](PRD.md) | Product Requirements |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Техническая архитектура |
| [SUMMARY.md](SUMMARY.md) | Итоговая сводка |
| [skill/references/](skill/references/) | Детальные гайды |

---

## Contributing

Pull requests welcome!

```bash
git checkout -b feature/amazing-feature
git commit -m 'Add amazing feature'
git push origin feature/amazing-feature
```

---

## Статистика v2

- **16 файлов** в skill (+2 скрипта, +2 гайда)
- **~3500+ строк** кода
- **20+ стеков** поддерживаются
- **11 команд** (было 8)
- **5 API интеграций** (Dokploy, CloudFlare, SSH, Git, OpenSSL)
- **40+ TLD** поддерживаются в DNS

---

## Лицензия

MIT License

---

**Сделано для Claude Code community**
