# Setup Guide — Настройка VPS с нуля

Этот гайд вызывается при команде `/vps setup <ip> <password>`.

Цель: Превратить чистый VPS в настроенный сервер с Dokploy, готовый к деплою проектов.

---

## Парсинг аргументов

Из `$ARGUMENTS` извлеки:
- `$1` — IP-адрес сервера
- `$2` — root пароль (для начального SSH-доступа)

Если какой-то из них отсутствует, спроси у пользователя.

---

## Шаг 1: Проверка SSH-доступа

Попробуй подключиться к серверу и получить информацию о системе:

```bash
bash scripts/ssh-exec.sh --password "$PASSWORD" "$IP" "uname -a && cat /etc/os-release"
```

**Обработка ошибок:**
- Если timeout → "Не удалось подключиться. Проверь IP, порт 22 открыт?"
- Если auth failed → "Неверный пароль. Проверь и попробуй снова."
- Если успешно → покажи ОС и версию

---

## Шаг 2: Проверка ресурсов

Проверь, достаточно ли ресурсов:

```bash
bash scripts/ssh-exec.sh --password "$PASSWORD" "$IP" "
  free -m | grep Mem | awk '{print \$2}'
  df -BG / | tail -1 | awk '{print \$2}' | tr -d 'G'
"
```

Распарси вывод:
- RAM (MB): минимум 2048 MB (2 GB)
- Disk (GB): минимум 30 GB

Если меньше:
- RAM < 2GB → "⚠️ Мало RAM. Dokploy рекомендует минимум 2 GB. Продолжить?"
- Disk < 30GB → "⚠️ Мало места на диске. Dokploy рекомендует минимум 30 GB."

Если пользователь хочет продолжить при недостатке RAM → предложи создать swap позже.

---

## Шаг 3: Обновление системы

```bash
bash scripts/ssh-exec.sh --password "$PASSWORD" "$IP" "
  apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y
"
```

Это может занять несколько минут. Покажи пользователю прогресс.

---

## Шаг 4: Настройка Firewall (UFW)

```bash
bash scripts/ssh-exec.sh --password "$PASSWORD" "$IP" "
  apt install -y ufw &&
  ufw allow 22/tcp &&
  ufw allow 80/tcp &&
  ufw allow 443/tcp &&
  ufw allow 3000/tcp &&
  ufw --force enable &&
  ufw status
"
```

Покажи пользователю статус UFW.

---

## Шаг 5: Установка Dokploy

```bash
bash scripts/ssh-exec.sh --password "$PASSWORD" "$IP" "
  curl -sSL https://dokploy.com/install.sh | sh
"
```

Этот скрипт:
- Установит Docker (если не установлен)
- Инициализирует Docker Swarm
- Создаст сеть `dokploy-network`
- Запустит контейнеры: Dokploy, PostgreSQL, Redis, Traefik

Установка займёт 3-5 минут. Покажи вывод скрипта.

---

## Шаг 6: Ожидание готовности Dokploy

После установки нужно подождать, пока Dokploy станет доступен:

```bash
bash scripts/wait-ready.sh "http://$IP:3000" 180 10
```

Если timeout → "Dokploy не запустился. Проверь логи: `docker service logs dokploy`"

Если успешно → "✓ Dokploy доступен на http://$IP:3000"

---

## Шаг 7: Первичная настройка Dokploy

Dokploy при первом запуске требует создания admin-аккаунта.

> **Важно (v0.27+):** Эндпоинт `auth.createUser` / `auth.createAdmin` удалён в Dokploy v0.27. Админ-аккаунт создаётся ТОЛЬКО вручную через веб-интерфейс.

**Шаг 7.1 — Попроси пользователя создать аккаунт:**

```
Dokploy установлен и работает!

Теперь нужно создать admin-аккаунт:

1. Открой в браузере: http://$IP:3000
2. Создай аккаунт (email + пароль)
3. После входа перейди в: Settings → Profile → API/CLI
4. Нажми "Generate API Key"
5. Скопируй API-ключ и введи его сюда
```

Дождись, пока пользователь введёт API-ключ.

**Шаг 7.2 — Валидация API-ключа:**

После получения ключа от пользователя проверь его работоспособность:

```bash
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "http://$IP:3000/api/settings.version" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
```

- Если `HTTP_CODE` = 200 → ключ рабочий, продолжай
- Если `HTTP_CODE` = 401/403 → "Неверный API-ключ. Проверь и попробуй снова."
- Если `HTTP_CODE` = 000/timeout → "Dokploy недоступен. Проверь http://$IP:3000"

Также извлеки и покажи версию Dokploy:
```bash
VERSION=$(echo "$BODY" | jq -r '.version // "unknown"')
echo "Dokploy версия: $VERSION"
```

---

## Шаг 8: Проверка версии и совместимости

После валидации API-ключа проверь версию Dokploy:

```bash
RESPONSE=$(bash scripts/dokploy-api.sh "$SERVER_NAME" GET settings.version)
VERSION=$(echo "$RESPONSE" | jq -r '.version // "unknown"')
```

Покажи пользователю:
```
Dokploy $VERSION установлен и подключён.
```

> Если версия < v0.27, предупреди: "Версия Dokploy устаревшая. Некоторые API-вызовы могут работать иначе. Рекомендуется обновить."

---

## Шаг 9: Сохранение в config/servers.json

Прочитай текущий конфиг (или создай пустой JSON):

```json
{
  "servers": {},
  "cloudflare": {},
  "defaults": {}
}
```

Добавь новый сервер:

```json
{
  "servers": {
    "main": {
      "host": "<IP>",
      "ssh_user": "root",
      "ssh_key": "",
      "dokploy_url": "http://<IP>:3000",
      "dokploy_api_key": "<api-key>",
      "added_at": "<current-date-ISO>"
    }
  },
  "defaults": {
    "server": "main"
  }
}
```

Сохрани через Write tool.

---

## Шаг 10: Опциональные улучшения

Спроси пользователя:
```
Сервер настроен! Рекомендую дополнительные улучшения:
1. Настроить swap (если RAM < 4 GB)
2. Установить fail2ban (защита от brute-force)
3. Настроить автообновления (unattended-upgrades)

Применить? (да/нет/выборочно)
```

### 10.1 Swap (если пользователь согласен)

```bash
bash scripts/ssh-exec.sh main "
  fallocate -l 2G /swapfile &&
  chmod 600 /swapfile &&
  mkswap /swapfile &&
  swapon /swapfile &&
  echo '/swapfile none swap sw 0 0' >> /etc/fstab &&
  swapon --show
"
```

### 10.2 Fail2ban

```bash
bash scripts/ssh-exec.sh main "
  apt install -y fail2ban &&
  systemctl enable fail2ban &&
  systemctl start fail2ban
"
```

### 10.3 Unattended upgrades

```bash
bash scripts/ssh-exec.sh main "
  apt install -y unattended-upgrades &&
  dpkg-reconfigure -plow unattended-upgrades
"
```

---

## Итоговый отчёт

Покажи пользователю:

```
✅ Сервер "main" настроен и готов к работе!

Детали:
  IP: <IP>
  Dokploy URL: http://<IP>:3000
  SSH: root@<IP>
  Firewall: UFW (22, 80, 443, 3000)
  Swap: <2 GB / Нет>
  Fail2ban: <Да / Нет>

Следующие шаги:
  1. Деплой проекта: /vps deploy <github-url> --domain <domain>
  2. Настроить CloudFlare: /vps config cloudflare <api-token>

Рекомендации по безопасности:
  - Настрой SSH-ключ: ssh-copy-id root@<IP>
  - Отключи password auth: PermitRootLogin prohibit-password
  - Закрой порт 3000 после настройки домена для Dokploy панели
```

---

## Обработка ошибок

| Ошибка | Действие |
|:-------|:---------|
| SSH timeout/refused | Проверь IP, доступность порта 22, firewall провайдера |
| sshpass not found | Попроси установить: `brew install sshpass` / `apt install sshpass` |
| Dokploy install failed | Покажи логи, предложи ручную установку по docs.dokploy.com |
| Dokploy не запустился | `docker service ls`, `docker service logs dokploy` → покажи причину |
| API-ключ не создан | Попроси пользователя создать вручную через UI |
