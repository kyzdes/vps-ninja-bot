# VPS Ninja — Claude Code Skill

Автоматизируй деплой приложений на VPS через Dokploy с помощью Claude Code.

## Возможности

- **Setup VPS** — настрой чистый VPS сервер одной командой (Ubuntu/Debian/CentOS)
- **Deploy проектов** — автоматическое определение стека (Next.js, Django, FastAPI, Go, Rust, Docker и др.)
- **CloudFlare DNS** — автоматическое создание/удаление DNS-записей
- **Управление БД** — создавай PostgreSQL, MySQL, MongoDB, Redis одной командой
- **Мониторинг** — статус серверов, просмотр логов, управление проектами

## Установка

### Для разработки (в проекте)

Скилл уже находится в `./skill/` этого репозитория.

### Для использования (глобально)

Скопируй skill в директорию Claude Code:

```bash
mkdir -p ~/.claude/skills/
cp -r skill ~/.claude/skills/vps
```

### Зависимости

Установи на своей машине (где запущен Claude Code):

```bash
# macOS
brew install jq sshpass

# Linux (Ubuntu/Debian)
sudo apt install jq sshpass

# Linux (CentOS/Fedora)
sudo yum install jq sshpass
```

## Быстрый старт

### 1. Настрой VPS

```
/vps setup 45.55.67.89 your-root-password
```

Claude:
- Подключится по SSH
- Установит Dokploy (Docker + PostgreSQL + Redis + Traefik)
- Настроит firewall
- Сгенерирует API-ключ
- Сохранит конфигурацию

### 2. Настрой CloudFlare (опционально)

Создай API token в CloudFlare с правами:
- Zone → DNS → Edit
- Zone → Zone → Read

```
/vps config cloudflare your-cloudflare-token
```

### 3. Задеплой проект

```
/vps deploy github.com/user/my-nextjs-app --domain app.example.com
```

Claude:
- Клонирует репо
- Определит стек (Next.js, порт 3000, env-переменные, Prisma → PostgreSQL)
- Спросит секреты (NEXTAUTH_SECRET, и т.д.)
- Создаст проект в Dokploy
- Создаст PostgreSQL
- Создаст DNS-запись в CloudFlare
- Задеплоит приложение
- Настроит SSL (Let's Encrypt)

### 4. Проверь статус

```
/vps status
```

## Команды

| Команда | Описание |
|:--------|:---------|
| `/vps setup <ip> <password>` | Настроить VPS с нуля |
| `/vps deploy <github-url> [--domain D]` | Деплой проекта |
| `/vps domain add <domain> <project>` | Добавить домен |
| `/vps domain remove <domain>` | Удалить домен |
| `/vps domain list` | Список доменов |
| `/vps db create <type> <name>` | Создать БД (postgres/mysql/mongo/redis) |
| `/vps db list` | Список БД |
| `/vps db delete <name>` | Удалить БД |
| `/vps status` | Статус сервера и проектов |
| `/vps logs <project> [--build]` | Логи приложения |
| `/vps destroy <project>` | Удалить проект |
| `/vps config` | Показать конфиг |
| `/vps config server add <name> <ip>` | Добавить сервер |
| `/vps config cloudflare <token>` | Настроить CloudFlare |

## Поддерживаемые стеки

- **Node.js**: Next.js, Nuxt, NestJS, Express, Remix, Vite
- **Python**: Django, FastAPI, Flask
- **Go**: Любые Go-приложения
- **Rust**: Любые Rust-приложения
- **Ruby**: Ruby on Rails, Sinatra
- **Java**: Spring Boot, Maven, Gradle
- **.NET**: ASP.NET Core
- **PHP**: Laravel, Symfony
- **Docker**: Dockerfile или docker-compose.yml

## Архитектура

```
~/.claude/skills/vps/
├── SKILL.md                    # Основной файл skill (команды, маршрутизация)
├── references/
│   ├── setup-guide.md          # Детальный гайд: настройка VPS
│   ├── deploy-guide.md         # Детальный гайд: деплой проекта (3 фазы)
│   ├── stack-detection.md      # Правила определения стека
│   └── dokploy-api-reference.md # Справочник Dokploy API
├── scripts/
│   ├── dokploy-api.sh          # Обёртка: Dokploy REST API
│   ├── cloudflare-dns.sh       # Обёртка: CloudFlare DNS API
│   ├── ssh-exec.sh             # Обёртка: SSH-команды
│   └── wait-ready.sh           # Polling: ожидание доступности
├── templates/
│   └── setup-server.sh         # Скрипт начальной настройки VPS
└── config/
    ├── servers.json            # Credentials (gitignored!)
    └── servers.json.example    # Пример конфигурации
```

## Безопасность

- `config/servers.json` **никогда** не коммитится в git (gitignored)
- API-ключи и пароли **никогда** не выводятся в ответы Claude
- Деструктивные операции (`destroy`) требуют подтверждения
- После setup рекомендуется:
  - Настроить SSH-ключ вместо пароля
  - Закрыть порт 3000 (настроить домен для Dokploy панели)

## Лицензия

MIT

## Contributing

Pull requests welcome!

1. Fork this repo
2. Create feature branch
3. Test locally
4. Submit PR

## Support

Issues: https://github.com/kyzdes/vps-ninja-bot/issues
