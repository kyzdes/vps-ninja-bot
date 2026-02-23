# Rollback Guide — Откат на предыдущий деплой

Этот гайд описывает процедуру отката приложения на предыдущую версию.

---

## Обзор

Rollback в Dokploy работает через повторный деплой предыдущей версии.
Dokploy хранит историю всех деплоев с их статусами и логами.

---

## Парсинг аргументов

Из `$ARGUMENTS` извлеки:
- `$1` — имя проекта/приложения
- `--to <deployment-id>` — конкретный деплой для отката (опционально)
- `--server <name>` — имя сервера (по умолчанию: из `defaults.server`)
- `--no-backup` — не создавать бэкап БД перед откатом

---

## Шаг 1: Получение истории деплоев

Найди приложение в проектах:

```bash
PROJECTS=$(bash scripts/dokploy-api.sh <server> GET project.all)
# Распарси JSON, найди applicationId по имени
```

Получи все деплои:

```bash
DEPLOYMENTS=$(bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=$APP_ID")
```

Распарси JSON, покажи таблицу:

```
История деплоев my-app:

 #  │ Deployment ID      │ Статус │ Дата                │ Commit
────┼────────────────────┼────────┼─────────────────────┼─────────
 1  │ dep_abc123 (текущ.) │ done   │ 2026-02-23 14:30    │ a1b2c3d
 2  │ dep_def456          │ done   │ 2026-02-22 11:00    │ e4f5g6h
 3  │ dep_ghi789          │ error  │ 2026-02-21 09:15    │ i7j8k9l
 4  │ dep_jkl012          │ done   │ 2026-02-20 16:45    │ m0n1o2p
 5  │ dep_mno345          │ done   │ 2026-02-19 10:30    │ q3r4s5t
```

---

## Шаг 2: Выбор версии

Если `--to` указан:
- Найди деплой с этим ID
- Убедись что он существует и его статус `done`

Если `--to` НЕ указан:
- Предложи последний успешный деплой, отличный от текущего:
  ```
  Откатить my-app на деплой #2 (dep_def456, от 2026-02-22)?
  Commit: e4f5g6h
  ```
- Дождись подтверждения

Если нет доступных деплоев для отката → сообщи:
```
Нет доступных версий для отката. Текущий деплой — единственный.
```

---

## Шаг 3: Автоматический бэкап (если включён)

Проверь настройку:
```bash
AUTO_BACKUP=$(jq -r '.settings.auto_backup_before_destroy // true' config/servers.json)
```

Проверь аргументы на `--no-backup`.

Если автобэкап включён и `--no-backup` не передан:

1. Определи, есть ли связанная БД (проверь проект на postgres/mysql/etc.)
2. Если БД есть:
   ```bash
   bash scripts/backup.sh create <server> <db-type> <container-name>
   ```
3. Сохрани путь к бэкапу для отчёта

---

## Шаг 4: Выполнение отката

Dokploy поддерживает повторный деплой через API.

### Вариант А: Если деплой был из GitHub

Обнови приложение на коммит из целевого деплоя:

```bash
# Получи данные целевого деплоя
TARGET=$(echo "$DEPLOYMENTS" | jq ".[$TARGET_INDEX]")
COMMIT=$(echo "$TARGET" | jq -r '.gitCommit // empty')

# Если есть коммит, обнови ветку/коммит
if [ -n "$COMMIT" ]; then
  bash scripts/dokploy-api.sh <server> POST application.update '{
    "applicationId": "'"$APP_ID"'",
    "sourceType": "github"
  }'
fi
```

### Вариант Б: Повторный деплой

Просто запусти новый деплой (Dokploy переразвернёт текущее состояние):

```bash
bash scripts/dokploy-api.sh <server> POST application.deploy '{
  "applicationId": "'"$APP_ID"'"
}'
```

---

## Шаг 5: Мониторинг

Отслеживай статус деплоя (аналогично deploy-guide.md):

```bash
while true; do
  RESPONSE=$(bash scripts/dokploy-api.sh <server> GET "deployment.all?applicationId=$APP_ID")
  STATUS=$(echo "$RESPONSE" | jq -r '.[0].status')

  case "$STATUS" in
    done)    echo "Откат завершён успешно"; break ;;
    error)   echo "Откат провалился"; break ;;
    *)       echo "Статус: $STATUS..."; sleep 5 ;;
  esac
done
```

---

## Шаг 6: Проверка

Если есть домен — проверь доступность:

```bash
bash scripts/wait-ready.sh "https://$DOMAIN" 120 10
```

---

## Шаг 7: Итоговый отчёт

```
Откат выполнен!

Проект:       my-app
Откачено:     dep_abc123 → dep_def456
Commit:       e4f5g6h
Домен:        https://app.example.com (доступен)
Бэкап БД:    /backups/my-app-db-20260223_143500.sql.gz

Если нужно вернуться:
  /vps backup restore my-app-db --file /backups/my-app-db-20260223_143500.sql.gz
  /vps deploy github.com/user/my-app --domain app.example.com
```

---

## Обработка ошибок

| Ситуация | Действие |
|:---------|:---------|
| Деплой не найден | Покажи список доступных деплоев |
| Откат провалился (build error) | Покажи логи, предложи вернуться к текущей версии |
| БД несовместима | Предложи восстановить из бэкапа |
| Нет деплоев | Сообщи, что откат невозможен |
| Бэкап не удался | Предупреди, спроси хочет ли продолжить без бэкапа |
