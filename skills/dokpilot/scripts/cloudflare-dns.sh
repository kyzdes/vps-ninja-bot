#!/bin/bash
# CloudFlare DNS API wrapper
# Usage:
#   cloudflare-dns.sh create <full-domain> <ip> [proxied=true|--no-proxy]
#   cloudflare-dns.sh delete <full-domain>
#   cloudflare-dns.sh list   <zone-domain>
#   cloudflare-dns.sh get    <full-domain>
#
# Examples:
#   cloudflare-dns.sh create app.example.com 203.0.113.10           # proxied (default)
#   cloudflare-dns.sh create app.example.com 203.0.113.10 true      # proxied
#   cloudflare-dns.sh create app.example.com 203.0.113.10 false     # DNS-only
#   cloudflare-dns.sh create app.example.com 203.0.113.10 --no-proxy  # DNS-only (alias)
#   cloudflare-dns.sh delete app.example.com
#   cloudflare-dns.sh list example.com
#
# The --no-proxy flag (or proxied=false) creates DNS records without CloudFlare proxy.
# This is REQUIRED for Let's Encrypt HTTP challenge validation.
# After certificate issuance, re-run with proxied=true to enable CDN/DDoS protection.
#
# Reads CloudFlare API token from config/servers.json
# Exit codes: 0 = success, 1 = config error, 2 = API error

set -euo pipefail

ACTION="${1:?Usage: cloudflare-dns.sh <create|delete|list|get> [args...]}"

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/../config/servers.json"

if [ ! -f "$CONFIG" ]; then
  echo '{"error": "Config not found. Run: /vps config cloudflare <token>"}' >&2
  exit 1
fi

# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

if ! TOKEN=$(resolve_secret '.cloudflare.api_token') || [ -z "$TOKEN" ]; then
  echo '{"error": "CloudFlare token not configured. Run: /vps config cloudflare <token>"}' >&2
  exit 1
fi

CF_API="https://api.cloudflare.com/client/v4"

# URL-encode a value for safe use inside a query string (RFC 3986 via jq @uri).
# Used for record/zone names so a domain with reserved chars can't smuggle
# extra query params or break the URL.
urlenc() {
  printf '%s' "$1" | jq -sRr @uri
}

# Build an A-record JSON body with jq (no string interpolation → no JSON
# injection from names/IPs). proxied is passed as a real JSON boolean.
# Usage: cf_body <name> <ip> <proxied-bool>
cf_body() {
  jq -n --arg name "$1" --arg content "$2" --argjson proxied "$3" \
    '{type: "A", name: $name, content: $content, proxied: $proxied, ttl: 1}'
}

cf_curl() {
  local method=$1 path=$2 body=${3:-}
  local args=(-s -S --max-time 15 -X "$method"
    -H "Authorization: Bearer $TOKEN"
    -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "${CF_API}/${path}"
}

# Get zone ID by domain (raw — no error output, used for probing)
_get_zone_id_raw() {
  local zone_domain=$1
  cf_curl GET "zones?name=$(urlenc "$zone_domain")&status=active" | jq -r '.result[0].id // empty'
}

# Extract zone domain from full domain (app.example.com → example.com)
# Handles multi-part TLDs (app.example.co.uk → example.co.uk) by probing CloudFlare API
get_zone_domain() {
  local domain="$1"
  # Try 2-part TLD first (most common: example.com, example.dev)
  local zone2 id2
  zone2=$(echo "$domain" | awk -F. '{print $(NF-1)"."$NF}')
  id2=$(_get_zone_id_raw "$zone2")
  if [ -n "$id2" ]; then echo "$zone2"; return; fi
  # Try 3-part TLD (example.co.uk, example.com.br)
  local zone3 id3
  zone3=$(echo "$domain" | awk -F. '{print $(NF-2)"."$(NF-1)"."$NF}')
  id3=$(_get_zone_id_raw "$zone3")
  if [ -n "$id3" ]; then echo "$zone3"; return; fi
  # Fallback to 2-part (will fail later with "Zone not found" if wrong)
  echo "$zone2"
}

# Get zone ID by domain
get_zone_id() {
  _get_zone_id_raw "$1"
}

# Find DNS record by name
find_record() {
  local zone_id=$1 record_name=$2
  cf_curl GET "zones/${zone_id}/dns_records?name=$(urlenc "$record_name")&type=A" | jq -r '.result[0] // empty'
}

# Parse proxied argument: supports true, false, --no-proxy
parse_proxied() {
  local arg="${1:-true}"
  case "$arg" in
    --no-proxy|false|False|FALSE|no|No|NO)
      echo "false"
      ;;
    *)
      echo "true"
      ;;
  esac
}

case "$ACTION" in
  create)
    DOMAIN="${2:?Missing domain}"
    IP="${3:?Missing IP address}"
    PROXIED=$(parse_proxied "${4:-true}")

    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    # Check if record exists
    EXISTING=$(find_record "$ZONE_ID" "$DOMAIN")

    BODY=$(cf_body "$DOMAIN" "$IP" "$PROXIED")
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
      # Update existing record
      RECORD_ID=$(echo "$EXISTING" | jq -r '.id')
      RESULT=$(cf_curl PUT "zones/${ZONE_ID}/dns_records/${RECORD_ID}" "$BODY")
    else
      # Create new record
      RESULT=$(cf_curl POST "zones/${ZONE_ID}/dns_records" "$BODY")
    fi

    # Check for API errors
    SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
    if [ "$SUCCESS" != "true" ]; then
      ERRORS=$(echo "$RESULT" | jq -r '.errors[0].message // "Unknown error"')
      echo "{\"error\": \"CloudFlare API error: $ERRORS\"}" >&2
      exit 2
    fi

    # Output result with proxy status
    PROXY_STATUS="proxied"
    [ "$PROXIED" = "false" ] && PROXY_STATUS="DNS-only (no proxy)"
    echo "$RESULT" | jq --arg status "$PROXY_STATUS" '.result | {id, name, content, proxied, proxy_status: $status}'
    ;;

  delete)
    DOMAIN="${2:?Missing domain}"
    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    EXISTING=$(find_record "$ZONE_ID" "$DOMAIN")
    if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
      RECORD_ID=$(echo "$EXISTING" | jq -r '.id')
      cf_curl DELETE "zones/${ZONE_ID}/dns_records/${RECORD_ID}"
    else
      echo "{\"error\": \"DNS record not found: $DOMAIN\"}" >&2
      exit 2
    fi
    ;;

  list)
    ZONE_DOMAIN="${2:?Missing zone domain}"
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    cf_curl GET "zones/${ZONE_ID}/dns_records?type=A" | jq '.result[] | {name, content, proxied}'
    ;;

  get)
    DOMAIN="${2:?Missing domain}"
    ZONE_DOMAIN=$(get_zone_domain "$DOMAIN")
    ZONE_ID=$(get_zone_id "$ZONE_DOMAIN")

    if [ -z "$ZONE_ID" ]; then
      echo "{\"error\": \"Zone not found for $ZONE_DOMAIN\"}" >&2
      exit 2
    fi

    find_record "$ZONE_ID" "$DOMAIN"
    ;;

  *)
    echo "Unknown action: $ACTION. Use: create, delete, list, get" >&2
    exit 1
    ;;
esac
