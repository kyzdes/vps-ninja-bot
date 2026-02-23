# Backup Guide — Управление бэкапами БД

Этот гайд описывает систему бэкапирования баз данных на VPS.

---

## Обзор

Система бэкапов поддерживает:
- **PostgreSQL** — `pg_dumpall` → gzip
- **MySQL/MariaDB** — `mysqldump` → gzip
- **MongoDB** — `mongodump --archive`
- **Redis** — BGSAVE → dump.rdb

Бэкапы хранятся на сервере в директории `/backups/` (настраивается через `settings.backup_dir`).

---

## Создание бэкапа

### Автоматическое определение типа

При команде `/vps backup create <db-name>`:

1. Получи список всех БД с сервера:
   ```bash
   bash scripts/dokploy-api.sh <server> GET project.all
   ```
2. Найди БД по имени в проектах
3. Определи тип: postgres, mysql, mariadb, mongo, redis
4. Определи имя Docker контейнера/сервиса

### Выполнение бэкапа

```bash
bash scripts/backup.sh create <server> <db-type> <container-name> [backup-dir]
```

Формат имени файла: `<container-name>-<YYYYMMDD_HHMMSS>.<ext>`

| Тип | Расширение | Метод |
|:----|:-----------|:------|
| PostgreSQL | `.sql.gz` | `pg_dumpall -U postgres \| gzip` |
| MySQL/MariaDB | `.sql.gz` | `mysqldump --all-databases \| gzip` |
| MongoDB | `.archive` | `mongodump --archive` |
| Redis | `.rdb` | `BGSAVE` + `docker cp` |

### Обработка ошибок

| Ошибка | Причина | Решение |
|:-------|:--------|:--------|
| Container not found | Имя контейнера неверное | Проверь через `docker ps` |
| Permission denied | Нет прав на `/backups/` | `mkdir -p /backups && chmod 755 /backups` |
| No space left | Диск переполнен | Запусти `/vps backup cleanup` |
| pg_dumpall failed | Неверный пользователь | Проверь пользователя БД |

---

## Восстановление из бэкапа

### Процедура

1. Покажи список доступных бэкапов:
   ```bash
   bash scripts/backup.sh list <server>
   ```

2. **ОБЯЗАТЕЛЬНО** попроси подтверждение — это деструктивная операция!

3. Восстанови:
   ```bash
   bash scripts/backup.sh restore <server> <db-type> <container-name> <backup-file>
   ```

### Важные предупреждения

- Восстановление **перезаписывает** текущие данные
- Для PostgreSQL: `pg_dumpall` создаёт полный дамп всех БД — восстановление затронет все базы
- Для Redis: перезапись dump.rdb требует рестарта (или `DEBUG LOADRDB`)
- Рекомендуется: создать бэкап текущего состояния перед восстановлением

---

## Ротация бэкапов

### Автоматическая очистка

```bash
bash scripts/backup.sh cleanup <server> [backup-dir] [keep-count]
```

По умолчанию хранятся последние 5 бэкапов (настраивается через `settings.backup_keep`).

### Рекомендуемая стратегия

| Частота | Хранить | Для |
|:--------|:--------|:----|
| Ежедневно | 7 последних | Все проекты |
| Перед деплоем | Автоматически | Если есть БД |
| Перед destroy | Автоматически | Если `auto_backup_before_destroy: true` |

---

## Автоматические бэкапы

### Перед destroy

Если в настройках `auto_backup_before_destroy: true`:
- `/vps destroy my-app` автоматически создаст бэкап БД перед удалением
- Путь к бэкапу покажется в отчёте об удалении

### Перед rollback

- `/vps rollback my-app` автоматически бэкапит БД перед откатом
- Это позволяет вернуться обратно, если откат не помог
