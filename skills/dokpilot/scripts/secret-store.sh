#!/bin/bash
# macOS Keychain secret store wrapper
#
# Usage:
#   secret-store.sh get <account>            Print secret to stdout (exit 1 if missing)
#   secret-store.sh set <account> [<value>]  Store or update secret. If <value> is
#                                            omitted, the secret is read from STDIN —
#                                            prefer this so the value never appears in
#                                            argv / `ps` / shell history.
#   secret-store.sh delete <account>         Remove secret
#   secret-store.sh list                     List accounts for service=dokpilot
#   secret-store.sh available                Exit 0 if Keychain is usable here, 1 otherwise
#
# All items are stored under service="dokpilot". Account names follow the
# convention "<server-name>:<field>" for server secrets and "cloudflare:<field>"
# for CloudFlare secrets.
#
# macOS only. On other platforms `available` exits 1 and other actions fail
# with a clear message — callers are expected to fall back to plain-file storage.
#
# Security note: we deliberately do NOT pass -T to `security`. At first access,
# macOS prompts the user for permission; clicking "Always Allow" whitelists the
# calling binary. This is safer than pre-authorising arbitrary callers.

set -euo pipefail

SERVICE="dokpilot"

_require_macos() {
  if [ "$(uname)" != "Darwin" ]; then
    echo '{"error": "Keychain is only available on macOS"}' >&2
    exit 1
  fi
  if ! command -v security >/dev/null 2>&1; then
    echo '{"error": "security CLI not found"}' >&2
    exit 1
  fi
}

ACTION="${1:?Usage: secret-store.sh <get|set|delete|list|available> [args...]}"

case "$ACTION" in
  available)
    if [ "$(uname)" = "Darwin" ] && command -v security >/dev/null 2>&1; then
      exit 0
    fi
    exit 1
    ;;

  get)
    _require_macos
    ACCOUNT="${2:?Missing account}"
    if ! VALUE=$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null); then
      echo "{\"error\": \"Secret not found in Keychain: $ACCOUNT\"}" >&2
      exit 1
    fi
    printf '%s' "$VALUE"
    ;;

  set)
    _require_macos
    ACCOUNT="${2:?Missing account}"
    # Value from $3, or from STDIN when $3 is omitted. Stdin keeps the secret out
    # of this process's argv (it still reaches `security` via -w, an OS-tool limit).
    if [ "$#" -ge 3 ]; then
      VALUE="$3"
    else
      VALUE="$(cat)"
    fi
    [ -n "$VALUE" ] || { echo '{"error": "empty value"}' >&2; exit 1; }
    COMMENT="Created by dokpilot skill on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if ! security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w "$VALUE" -j "$COMMENT" 2>/dev/null; then
      echo "{\"error\": \"Failed to write secret to Keychain: $ACCOUNT\"}" >&2
      exit 1
    fi
    echo "{\"status\": \"ok\", \"account\": \"$ACCOUNT\"}"
    ;;

  delete)
    _require_macos
    ACCOUNT="${2:?Missing account}"
    if ! security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
      echo "{\"error\": \"Secret not found: $ACCOUNT\"}" >&2
      exit 1
    fi
    echo "{\"status\": \"deleted\", \"account\": \"$ACCOUNT\"}"
    ;;

  list)
    _require_macos
    # `security dump-keychain` is heavy; use find-generic-password in a loop
    # isn't possible without knowing accounts. Instead, dump and grep by service.
    security dump-keychain 2>/dev/null \
      | awk -v svc="\"$SERVICE\"" '
          /"svce"<blob>=/ { in_item=($0 ~ svc) }
          /"acct"<blob>=/ && in_item {
            sub(/.*"acct"<blob>="/, "")
            sub(/".*/, "")
            print
          }
        '
    ;;

  *)
    echo "Unknown action: $ACTION. Use: get, set, delete, list, available" >&2
    exit 1
    ;;
esac
