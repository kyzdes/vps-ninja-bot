# 🚀 VPS Ninja

**Claude Code skill для автоматизации VPS через Dokploy**

Деплой приложений на VPS одной командой — без DevOps-опыта.

---

## ✨ Возможности

- **🔧 Setup VPS** — настрой чистый сервер за 5 минут (Dokploy + firewall + swap)
- **📦 Auto Deploy** — автоопределение стека (Next.js, Django, FastAPI, Go, Rust, Docker...)
- **🌐 DNS Management** — автоматическое создание CloudFlare DNS + SSL сертификатов
- **💾 Database Management** — PostgreSQL, MySQL, MongoDB, Redis одной командой
- **📊 Monitoring** — статус сервера, логи, управление проектами

---

## 🎯 Примеры использования

### Настройка VPS с нуля

```bash
/vps setup 45.55.67.89 your-root-password
```

Claude автоматически:
- Установит Dokploy (Docker + PostgreSQL + Redis + Traefik)
- Настроит firewall (UFW)
- Создаст swap (если RAM < 4GB)
- Сгенерирует API-ключ

### Деплой Next.js приложения

```bash
/vps deploy github.com/user/my-nextjs-app --domain app.example.com
```

Claude автоматически:
- Клонирует репо и определит стек (Next.js 14, порт 3000)
- Найдёт env-переменные (`NEXTAUTH_SECRET`, `DATABASE_URL`)
- Создаст PostgreSQL (если используется Prisma)
- Настроит CloudFlare DNS
- Задеплоит с SSL (Let's Encrypt)
- Выдаст ссылку: `https://app.example.com`

### Проверка статуса

```bash
/vps status
```

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

## 📋 Все команды

| Команда | Описание |
|:--------|:---------|
| `/vps setup <ip> <password>` | Настроить VPS с нуля |
| `/vps deploy <github-url> [--domain D]` | Деплой проекта из GitHub |
| `/vps domain add <domain> <project>` | Добавить домен к проекту |
| `/vps domain remove <domain>` | Удалить домен |
| `/vps domain list` | Список всех доменов |
| `/vps db create <type> <name>` | Создать БД (postgres/mysql/mongo/redis) |
| `/vps db list` | Список всех БД |
| `/vps db delete <name>` | Удалить БД |
| `/vps status [--server <name>]` | Статус сервера и проектов |
| `/vps logs <project> [--build]` | Логи приложения или билда |
| `/vps destroy <project>` | Удалить проект (с подтверждением) |
| `/vps config` | Показать конфигурацию |
| `/vps config server add <name> <ip>` | Добавить сервер в конфиг |
| `/vps config cloudflare <token>` | Настроить CloudFlare API |

---

## 🛠 Поддерживаемые стеки

**Автоматическое определение:**

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

## 📦 Установка

### Требования

- **Claude Code** (CLI или Desktop)
- **VPS сервер** (Ubuntu/Debian/CentOS, минимум 2GB RAM)
- **CloudFlare аккаунт** (опционально, для DNS)

### Зависимости

Установи на своей машине:

```bash
# macOS
brew install jq sshpass

# Linux (Ubuntu/Debian)
sudo apt install jq sshpass

# Linux (CentOS/Fedora)
sudo yum install jq sshpass
```

### Установка skill

```bash
# Клонируй репозиторий
git clone https://github.com/kyzdes/vps-ninja-bot.git
cd vps-ninja-bot

# Скопируй skill в Claude Code
cp -r skill ~/.claude/skills/vps

# Готово! Skill доступен
```

---

## 🚀 Быстрый старт

### 1. Настрой VPS

```bash
/vps setup 45.55.67.89 your-root-password
```

### 2. Настрой CloudFlare (опционально)

Создай API token в CloudFlare:
- Zone → DNS → Edit
- Zone → Zone → Read

```bash
/vps config cloudflare your-cloudflare-token
```

### 3. Задеплой проект

```bash
/vps deploy github.com/user/my-app --domain app.example.com
```

Claude спросит только **секреты** (API keys, tokens), всё остальное определит сам:
- Стек и фреймворк
- Порт приложения
- Env-переменные
- Зависимости от БД

### 4. Готово!

Приложение доступно на `https://app.example.com` с автоматическим SSL 🎉

---

## 📚 Документация

| Документ | Описание |
|:---------|:---------|
| [PRD.md](PRD.md) | Product Requirements — команды, сценарии использования |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Техническая архитектура, data flows, примеры кода |
| [SUMMARY.md](SUMMARY.md) | Итоговая сводка проекта |
| [skill/README.md](skill/README.md) | Документация для пользователей skill |
| [skill/references/](skill/references/) | Детальные гайды по setup и deploy |

---

## 🏗 Архитектура

```
vps-ninja-bot/
├── skill/                      # Готовый к установке skill
│   ├── SKILL.md                # Маршрутизатор команд (470 строк)
│   ├── scripts/                # Shell-скрипты (API wrappers)
│   │   ├── dokploy-api.sh      # Dokploy REST API
│   │   ├── cloudflare-dns.sh   # CloudFlare DNS API
│   │   ├── ssh-exec.sh         # SSH executor
│   │   └── wait-ready.sh       # URL checker
│   ├── references/             # Reference guides (ленивая загрузка)
│   │   ├── setup-guide.md      # Гайд: настройка VPS
│   │   ├── deploy-guide.md     # Гайд: деплой проекта (3 фазы)
│   │   ├── stack-detection.md  # Правила определения стека
│   │   └── dokploy-api-reference.md
│   ├── templates/
│   │   └── setup-server.sh     # Скрипт настройки VPS
│   └── config/
│       └── servers.json        # Credentials (gitignored)
│
├── PRD.md                      # Product Requirements
├── ARCHITECTURE.md             # Техническая документация
└── SUMMARY.md                  # Итоговая сводка
```

**Принципы:**
- **Ленивая загрузка** — reference guides грузятся только когда нужны
- **Shell-скрипты как stdlib** — детерминированные обёртки с retry и error handling
- **Трёхфазный deploy** — Анализ → Уточнение → Деплой
- **Безопасность** — credentials в gitignore, секреты маскируются в выводе

---

## 🔒 Безопасность

- ✅ `config/servers.json` никогда не коммитится (gitignored)
- ✅ API-ключи и пароли маскируются в ответах Claude
- ✅ Деструктивные операции (`destroy`) требуют подтверждения
- ✅ DNS-операции показывают предпросмотр изменений
- ✅ Минимальные права CloudFlare (только DNS:Edit, Zone:Read)

### Рекомендации после setup

1. Настрой SSH-ключ вместо пароля:
   ```bash
   ssh-copy-id root@45.55.67.89
   ```

2. Отключи password auth в `/etc/ssh/sshd_config`:
   ```
   PermitRootLogin prohibit-password
   ```

3. Закрой порт 3000 после настройки домена для Dokploy панели

---

## 🤝 Contributing

Pull requests welcome!

1. Fork this repo
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## 📊 Статистика проекта

- **14 файлов** в skill
- **~2296 строк** кода
- **20+ стеков** поддерживаются
- **8 команд** для полного контроля
- **4 API интеграции** (Dokploy, CloudFlare, SSH, Git)

---

## 📄 Лицензия

MIT License — используй как хочешь!

---

## 🙏 Благодарности

- **[Dokploy](https://dokploy.com)** — open-source self-hosted PaaS
- **[CloudFlare](https://cloudflare.com)** — DNS и CDN
- **[Claude Code](https://claude.ai)** — Agent Skills framework
- **[Anthropic](https://anthropic.com)** — Claude AI

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/kyzdes/vps-ninja-bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/kyzdes/vps-ninja-bot/discussions)
- **Dokploy Docs**: [docs.dokploy.com](https://docs.dokploy.com)

---

## 🎯 Roadmap (v2)

- [ ] Мониторинг и алерты (Grafana, Prometheus)
- [ ] CI/CD пайплайны (auto-deploy по push в main)
- [ ] Backup-менеджмент (автобэкапы БД)
- [ ] Мультисерверный кластер (Docker Swarm multi-node)
- [ ] Поддержка других панелей (Coolify, CapRover)
- [ ] GitHub App интеграция для Dokploy
- [ ] Web UI для управления конфигурацией

---

<div align="center">

**Сделано с ❤️ для Claude Code community**

[⭐ Star this repo](https://github.com/kyzdes/vps-ninja-bot) • [🐛 Report Bug](https://github.com/kyzdes/vps-ninja-bot/issues) • [✨ Request Feature](https://github.com/kyzdes/vps-ninja-bot/issues)

</div>
