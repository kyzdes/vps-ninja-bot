# V3 Features Guide

Справочник по всем новым командам VPS Ninja v3.

---

## `/vps deploy --validate` — Post-Deploy Validation

Добавляет проверку здоровья после деплоя с автоматическим откатом.

### Использование

```bash
/vps deploy github.com/user/app --domain app.example.com --validate /health --auto-rollback
```

### Как это работает

1. Деплой выполняется как обычно (deploy-guide.md)
2. После успешного билда запускается валидация:
   ```bash
   bash scripts/deploy-validator.sh validate <server> <app-id> https://app.example.com \
     --health /health --timeout 120 --retries 3 --auto-rollback
   ```
3. Если 3 последовательных проверки вернули HTTP 2xx → деплой подтверждён
4. Если timeout → автоматический откат (если `--auto-rollback`)

### Smoke Tests

Для проверки нескольких endpoints:
```bash
bash scripts/deploy-validator.sh smoke <server> <app-id> https://app.example.com '["/", "/api/health", "/login"]'
```

### Deployment Gates

Проверка latency и error rate:
```bash
bash scripts/deploy-validator.sh gate <server> <app-id> https://app.example.com \
  --latency 500 --error-rate 5
```
- Если avg latency > 500ms → откат
- Если error rate > 5% → откат

---

## `/vps notify` — Уведомления

### Настройка

```bash
/vps config notify slack https://hooks.slack.com/services/T.../B.../...
/vps config notify telegram <bot-token> <chat-id>
/vps config notify discord https://discord.com/api/webhooks/...
```

### Когда отправляются

- Deploy started / completed / failed
- Auto-rollback triggered
- Health alert (CPU > 90%, disk > 85%)
- SSL certificate expiring (< 7 days)
- Cron job failed 3+ times

### Ручная отправка

```bash
bash scripts/notify.sh send <server> "Custom message" "warning"
```

### Тестирование

```bash
bash scripts/notify.sh test <server>
```

---

## `/vps env` — Управление переменными окружения

### Просмотр (секреты маскируются)

```bash
/vps env list <project>
```

### Установка с аудитом

```bash
/vps env set <project> DATABASE_URL=postgres://...
```
Каждое изменение записывается в `config/env-history.json`.

### Сравнение окружений

```bash
/vps env diff staging-app prod-app
```

Показывает:
- Переменные только в app1
- Переменные только в app2
- Переменные с разными значениями

### Аудит изменений

```bash
/vps env audit [project]
```

Показывает: кто, когда, что менял.

### Импорт/Экспорт

```bash
/vps env export <project> > .env.backup
/vps env import <project> .env.production
```

---

## `/vps monitor` — Мониторинг

### Включение (деплоит Prometheus + Grafana + node_exporter + cAdvisor)

```bash
/vps monitor enable
```

Автоматически устанавливает:
- **Prometheus** (порт 9090) — метрики
- **Grafana** (порт 3001) — дашборды
- **node_exporter** — метрики сервера
- **cAdvisor** — метрики Docker-контейнеров
- **Alertmanager** — алерты

### Алерты по умолчанию

| Алерт | Условие | Время |
|:------|:--------|:------|
| HighCPU | CPU > 90% | 5 мин |
| HighMemory | RAM > 90% | 5 мин |
| DiskAlmostFull | Disk > 85% | 10 мин |
| ContainerDown | Контейнер упал | 1 мин |
| SSLExpiringSoon | SSL < 7 дней | 1 час |

### Настройка webhook для алертов

```bash
/vps monitor alert slack https://hooks.slack.com/services/...
```

### PromQL запросы

```bash
/vps monitor query "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100"
```

---

## `/vps db analyze` — Анализ БД

### Статистика

```bash
/vps db analyze stats <db-name>
```
→ Размер, подключения, версия, uptime.

### Медленные запросы (pg_stat_statements)

```bash
/vps db analyze slowlog <db-name> --top 10
```
→ Топ-10 запросов по среднему времени.

### Анализ индексов

```bash
/vps db analyze indexes <db-name>
```
→ Отсутствующие индексы, неиспользуемые индексы, дубликаты.

### Размеры таблиц

```bash
/vps db analyze tables <db-name>
```

---

## `/vps cron` — Scheduled Tasks

### Добавить задачу

```bash
/vps cron add backup-daily "0 3 * * *" "pg_dumpall -U postgres | gzip > /backups/daily.sql.gz" my-db-container
```

### Просмотр

```bash
/vps cron list
/vps cron status
/vps cron logs backup-daily
```

### Ручной запуск

```bash
/vps cron run backup-daily
```

### Удаление

```bash
/vps cron remove backup-daily
```

---

## `/vps security` — Security Audit

### Полный аудит сервера

```bash
/vps security scan
```

Проверяет:
- SSH: root login, password auth, порт
- Firewall: UFW/firewalld
- fail2ban: статус, забаненные IP
- Обновления: pending security updates
- Docker: privileged containers, dangling images

### Сканирование зависимостей

```bash
/vps security deps <project>
```
→ `npm audit`, `pip-audit`, `bundler-audit`, `govulncheck`

### Сканирование портов

```bash
/vps security ports
```
→ Открытые порты (внешние + внутренние).

### SSL-безопасность

```bash
/vps security ssl app.example.com
```
→ TLS версии, security headers, cipher suites.

---

## `/vps template` — App Templates

### Доступные шаблоны

| Шаблон | Описание |
|:-------|:---------|
| `wordpress` | WordPress + MySQL |
| `ghost` | Ghost publishing + MySQL |
| `plausible` | Plausible Analytics + PostgreSQL + ClickHouse |
| `uptime-kuma` | Uptime Kuma мониторинг |
| `n8n` | n8n workflow automation + PostgreSQL |

### Деплой шаблона

```bash
/vps template deploy wordpress --domain blog.example.com
```

Claude автоматически:
1. Генерирует пароли для БД
2. Подставляет домен и секреты в шаблон
3. Деплоит через Dokploy compose
4. Создаёт DNS-запись
5. Настраивает SSL
