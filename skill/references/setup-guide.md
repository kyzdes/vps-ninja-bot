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

**Вариант 1 — Через UI (попроси пользователя):**
```
Открой http://$IP:3000 в браузере и создай admin-аккаунт.
После этого:
1. Зайди в Settings → Profile → API/CLI
2. Нажми "Generate API Key"
3. Скопируй API-ключ и введи его сюда: /vps config server add main $IP --api-key <key>
```

**Вариант 2 — Попытаться автоматизировать через API (если Dokploy поддерживает):**

Dokploy имеет endpoint `POST /api/auth.createAdmin`:
```json
{
  "email": "admin@example.com",
  "password": "generated-password"
}
```

Попробуй:
```bash
curl -s -X POST "http://$IP:3000/api/auth.createAdmin" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@vps-ninja.local",
    "password": "'"$(openssl rand -base64 24)"'"
  }'
```

Если вернёт `{success: true, token: "..."}` → используй токен для генерации API-ключа.

Если вернёт 404 или error → переходи к варианту 1 (попроси пользователя создать вручную).

---

## Шаг 8: Генерация API-ключа

Если удалось создать admin-аккаунт автоматически и получить токен:

```bash
curl -s -X POST "http://$IP:3000/api/apiKey.create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "VPS Ninja Auto-Generated",
    "expiresAt": null
  }'
```

Распарси ответ, получи `apiKey`.

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
