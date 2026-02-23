#!/bin/bash
# Notification dispatcher — Slack, Telegram, Discord webhooks
# Usage:
#   notify.sh send    <server> <message> [level]       # Send to all configured channels
#   notify.sh slack   <webhook-url> <message> [level]   # Send to Slack
#   notify.sh telegram <bot-token> <chat-id> <message>  # Send to Telegram
#   notify.sh discord <webhook-url> <message> [level]   # Send to Discord
#   notify.sh test    <server>                           # Test all configured channels
#
# Levels: success, warning, error, info (default: info)
# Reads notification config from config/servers.json → .notifications
#
# Exit codes: 0 = sent, 1 = config error, 2 = send error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd curl jq

ACTION="${1:?Usage: notify.sh <send|slack|telegram|discord|test> ...}"

# ── Color/emoji by level ──

get_emoji() {
  case "${1:-info}" in
    success) echo "✅" ;;
    warning) echo "⚠️" ;;
    error)   echo "🚨" ;;
    info)    echo "ℹ️" ;;
    *)       echo "📌" ;;
  esac
}

get_slack_color() {
  case "${1:-info}" in
    success) echo "good" ;;
    warning) echo "warning" ;;
    error)   echo "danger" ;;
    *)       echo "#439FE0" ;;
  esac
}

# ── Senders ──

send_slack() {
  local webhook="$1" message="$2" level="${3:-info}"
  local emoji=$(get_emoji "$level")
  local color=$(get_slack_color "$level")
  local hostname=$(hostname 2>/dev/null || echo "vps")
  local timestamp=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

  local payload=$(jq -n \
    --arg text "$emoji $message" \
    --arg color "$color" \
    --arg ts "$timestamp" \
    --arg host "$hostname" \
    '{
      attachments: [{
        color: $color,
        text: $text,
        footer: ("VPS Ninja | " + $host),
        ts: (now | floor)
      }]
    }')

  log_debug "Sending to Slack: $message"
  curl -s -X POST "$webhook" -H "Content-Type: application/json" -d "$payload" --max-time 10 >/dev/null 2>&1 || {
    log_error "Failed to send Slack notification"
    return 2
  }
}

send_telegram() {
  local bot_token="$1" chat_id="$2" message="$3" level="${4:-info}"
  local emoji=$(get_emoji "$level")
  local timestamp=$(date -u +"%H:%M UTC")

  local text="${emoji} *VPS Ninja* (${timestamp})
${message}"

  log_debug "Sending to Telegram: $message"
  curl -s -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    -d "text=${text}" \
    -d "parse_mode=Markdown" \
    --max-time 10 >/dev/null 2>&1 || {
    log_error "Failed to send Telegram notification"
    return 2
  }
}

send_discord() {
  local webhook="$1" message="$2" level="${3:-info}"
  local emoji=$(get_emoji "$level")
  local color=0
  case "$level" in
    success) color=3066993 ;;
    warning) color=16776960 ;;
    error)   color=15158332 ;;
    *)       color=3447003 ;;
  esac

  local payload=$(jq -n \
    --arg desc "$message" \
    --argjson color "$color" \
    '{
      embeds: [{
        title: "VPS Ninja",
        description: $desc,
        color: $color,
        timestamp: (now | todate)
      }]
    }')

  log_debug "Sending to Discord: $message"
  curl -s -X POST "$webhook" -H "Content-Type: application/json" -d "$payload" --max-time 10 >/dev/null 2>&1 || {
    log_error "Failed to send Discord notification"
    return 2
  }
}

# ── Command dispatch ──

case "$ACTION" in
  send)
    SERVER="${2:?Missing server name}"
    MESSAGE="${3:?Missing message}"
    LEVEL="${4:-info}"

    require_config

    # Read notification channels from config
    SLACK_URL=$(config_get ".notifications.slack.webhook_url")
    TG_TOKEN=$(config_get ".notifications.telegram.bot_token")
    TG_CHAT=$(config_get ".notifications.telegram.chat_id")
    DISCORD_URL=$(config_get ".notifications.discord.webhook_url")

    SENT=0

    if [ -n "$SLACK_URL" ]; then
      send_slack "$SLACK_URL" "$MESSAGE" "$LEVEL" && SENT=$((SENT + 1))
    fi

    if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
      send_telegram "$TG_TOKEN" "$TG_CHAT" "$MESSAGE" "$LEVEL" && SENT=$((SENT + 1))
    fi

    if [ -n "$DISCORD_URL" ]; then
      send_discord "$DISCORD_URL" "$MESSAGE" "$LEVEL" && SENT=$((SENT + 1))
    fi

    if [ "$SENT" -eq 0 ]; then
      log_warn "No notification channels configured. Use: /vps config notify slack <url>"
    else
      log_info "Notification sent to $SENT channel(s)"
    fi

    echo "{\"sent\": $SENT, \"level\": \"$LEVEL\"}"
    ;;

  slack)
    WEBHOOK="${2:?Missing Slack webhook URL}"
    MESSAGE="${3:?Missing message}"
    LEVEL="${4:-info}"
    send_slack "$WEBHOOK" "$MESSAGE" "$LEVEL"
    echo '{"status": "sent", "channel": "slack"}'
    ;;

  telegram)
    BOT_TOKEN="${2:?Missing Telegram bot token}"
    CHAT_ID="${3:?Missing Telegram chat ID}"
    MESSAGE="${4:?Missing message}"
    LEVEL="${5:-info}"
    send_telegram "$BOT_TOKEN" "$CHAT_ID" "$MESSAGE" "$LEVEL"
    echo '{"status": "sent", "channel": "telegram"}'
    ;;

  discord)
    WEBHOOK="${2:?Missing Discord webhook URL}"
    MESSAGE="${3:?Missing message}"
    LEVEL="${4:-info}"
    send_discord "$WEBHOOK" "$MESSAGE" "$LEVEL"
    echo '{"status": "sent", "channel": "discord"}'
    ;;

  test)
    SERVER="${2:?Missing server name}"
    log_info "Testing all notification channels for server: $SERVER"

    require_config
    SLACK_URL=$(config_get ".notifications.slack.webhook_url")
    TG_TOKEN=$(config_get ".notifications.telegram.bot_token")
    TG_CHAT=$(config_get ".notifications.telegram.chat_id")
    DISCORD_URL=$(config_get ".notifications.discord.webhook_url")

    [ -n "$SLACK_URL" ] && send_slack "$SLACK_URL" "Test notification from VPS Ninja" "info" && log_info "Slack: OK" || log_warn "Slack: not configured"
    [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] && send_telegram "$TG_TOKEN" "$TG_CHAT" "Test notification from VPS Ninja" "info" && log_info "Telegram: OK" || log_warn "Telegram: not configured"
    [ -n "$DISCORD_URL" ] && send_discord "$DISCORD_URL" "Test notification from VPS Ninja" "info" && log_info "Discord: OK" || log_warn "Discord: not configured"
    ;;

  *)
    die "Unknown action: $ACTION. Use: send, slack, telegram, discord, test" 1
    ;;
esac
