#!/bin/bash
# CloudFlare DNS API wrapper
# Usage:
#   cloudflare-dns.sh create <full-domain> <ip> [proxied=true]
#   cloudflare-dns.sh delete <full-domain>
#   cloudflare-dns.sh list   <zone-domain>
#   cloudflare-dns.sh get    <full-domain>
#   cloudflare-dns.sh upsert <full-domain> <ip> [proxied=true]  # create or update
#
# Examples:
#   cloudflare-dns.sh create app.example.com 45.55.67.89
#   cloudflare-dns.sh create app.example.co.uk 45.55.67.89 false
#   cloudflare-dns.sh delete app.example.com
#   cloudflare-dns.sh list example.com
#
# Reads CloudFlare API token from config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = API error

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_cmd jq curl

ACTION="${1:?Usage: cloudflare-dns.sh <create|delete|list|get|upsert> [args...]}"

# Load CloudFlare config
require_cloudflare
TOKEN="$CF_TOKEN"

CF_API="https://api.cloudflare.com/client/v4"

# Rate limiting: minimum delay between API calls (ms)
CF_RATE_DELAY="${CF_RATE_DELAY:-0.2}"

_last_call=0
cf_rate_limit() {
  sleep "$CF_RATE_DELAY" 2>/dev/null || true
}

# CloudFlare API wrapper with error handling
cf_curl() {
  local method=$1 path=$2 body=${3:-}
  cf_rate_limit

  local args=(-s -S --max-time 15 -X "$method"
    -H "Authorization: Bearer $TOKEN"
    -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")

  log_debug "CF API: $method /$path"

  local response
  response=$(curl "${args[@]}" "${CF_API}/${path}" 2>&1) || {
    die "Network error connecting to CloudFlare API" 3
  }

  # Check for API-level errors
  local success
  success=$(echo "$response" | jq -r '.success // true' 2>/dev/null)
  if [ "$success" = "false" ]; then
    local error_msg
    error_msg=$(echo "$response" | jq -r '.errors[0].message // "Unknown CF error"' 2>/dev/null)
    local error_code
    error_code=$(echo "$response" | jq -r '.errors[0].code // 0' 2>/dev/null)
    log_error "CloudFlare API error ($error_code): $error_msg"
    echo "$response" >&2
    return 2
  fi

  echo "$response"
}

# ── Zone operations (deduplicated) ──

# Resolve zone: domain → zone_id
# Usage: resolve_zone "app.example.com"
# Sets: ZONE_ID, ZONE_DOMAIN
resolve_zone() {
  local full_domain="$1"
  ZONE_DOMAIN=$(get_zone_domain "$full_domain")
  log_debug "Resolving zone for $full_domain → $ZONE_DOMAIN"

  ZONE_ID=$(cf_curl GET "zones?name=${ZONE_DOMAIN}&status=active" | jq -r '.result[0].id // empty')

  if [ -z "$ZONE_ID" ]; then
    die_detail "Zone not found for '$ZONE_DOMAIN'" \
      "Ensure your domain is added to CloudFlare and the API token has Zone:Read permission" 2
  fi

  log_debug "Zone ID: $ZONE_ID"
}

# Find DNS A-record by name in a zone
# Usage: find_a_record "$ZONE_ID" "app.example.com"
# Returns: JSON record object or empty
find_a_record() {
  local zone_id=$1 record_name=$2
  cf_curl GET "zones/${zone_id}/dns_records?name=${record_name}&type=A" \
    | jq -r '.result[0] // empty'
}

# ── Upsert helper (create or update A record) ──

do_upsert() {
  local domain="$1" ip="$2" proxied="${3:-true}"

  # Normalize proxied to valid JSON boolean
  [[ "$proxied" == "true" ]] || proxied=false

  validate_domain "$domain" || die "Invalid domain format: $domain" 1
  validate_ip "$ip" || die "Invalid IP format: $ip" 1

  resolve_zone "$domain"

  local existing
  existing=$(find_a_record "$ZONE_ID" "$domain")

  local record_body
  record_body=$(jq -n --arg name "$domain" --arg content "$ip" --argjson proxied "$proxied" \
    '{type: "A", name: $name, content: $content, proxied: $proxied, ttl: 1}')

  if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    local record_id old_ip
    record_id=$(echo "$existing" | jq -r '.id')
    old_ip=$(echo "$existing" | jq -r '.content')
    log_info "Updating A record: $domain ($old_ip → $ip)"
    cf_curl PUT "zones/${ZONE_ID}/dns_records/${record_id}" "$record_body"
  else
    log_info "Creating A record: $domain → $ip (proxied=$proxied)"
    cf_curl POST "zones/${ZONE_ID}/dns_records" "$record_body"
  fi
}

# ── Command dispatch ──

case "$ACTION" in
  create|upsert)
    DOMAIN="${2:?Missing domain}"
    IP="${3:?Missing IP address}"
    PROXIED="${4:-true}"
    do_upsert "$DOMAIN" "$IP" "$PROXIED"
    ;;

  delete)
    DOMAIN="${2:?Missing domain}"
    validate_domain "$DOMAIN" || die "Invalid domain format: $DOMAIN" 1
    resolve_zone "$DOMAIN"

    EXISTING=$(find_a_record "$ZONE_ID" "$DOMAIN")
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
      RECORD_ID=$(echo "$EXISTING" | jq -r '.id')
      log_info "Deleting A record: $DOMAIN"
      cf_curl DELETE "zones/${ZONE_ID}/dns_records/${RECORD_ID}"
    else
      die "DNS A record not found: $DOMAIN" 2
    fi
    ;;

  list)
    ZONE_DOMAIN="${2:?Missing zone domain}"
    # For list, the user passes zone domain directly
    log_debug "Listing A records for zone: $ZONE_DOMAIN"
    ZONE_ID=$(cf_curl GET "zones?name=${ZONE_DOMAIN}&status=active" | jq -r '.result[0].id // empty')
    [ -z "$ZONE_ID" ] && die "Zone not found for $ZONE_DOMAIN" 2

    cf_curl GET "zones/${ZONE_ID}/dns_records?type=A&per_page=100" \
      | jq '[.result[] | {name, content, proxied, ttl}]'
    ;;

  get)
    DOMAIN="${2:?Missing domain}"
    validate_domain "$DOMAIN" || die "Invalid domain format: $DOMAIN" 1
    resolve_zone "$DOMAIN"
    find_a_record "$ZONE_ID" "$DOMAIN"
    ;;

  *)
    die "Unknown action: $ACTION. Use: create, delete, list, get, upsert" 1
    ;;
esac
