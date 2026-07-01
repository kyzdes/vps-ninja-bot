#!/usr/bin/env bash
# set-result.sh — set fields on job.result. Usually called once at the end.
#
# Usage: set-result.sh key=value [key=value ...]
#
# Examples:
#   set-result.sh app_id=abc123 url=https://app.example.com server=main
#   set-result.sh error="Build failed: missing env DATABASE_URL"
#
# All values are treated as strings (the schema is liberal — result is
# a free-form object that the UI renders verbatim).

source "$(dirname "$0")/_jq-patch.sh"

if [ $# -eq 0 ]; then
  echo "Usage: set-result.sh key=value [key=value ...]" >&2
  exit 2
fi

# Build the patch incrementally — collect all key=value pairs first
FILTER='.result = (.result // {})'
ARGS=()
for kv in "$@"; do
  KEY="${kv%%=*}"
  VAL="${kv#*=}"
  if [ "$KEY" = "$kv" ]; then
    echo "skip (no =): $kv" >&2
    continue
  fi
  ARGS+=(--arg "K_$KEY" "$KEY" --arg "V_$KEY" "$VAL")
  FILTER+=" | .result[\"\$K_${KEY} | (\$K_${KEY})\"] = \$V_${KEY}"
done

# Simpler: just walk the kv pairs in one pass via jq's reduce.
# Use --argjson kvs to pass an array of [k,v] pairs.
KVS_JSON='['
FIRST=1
for kv in "$@"; do
  KEY="${kv%%=*}"
  VAL="${kv#*=}"
  if [ "$KEY" = "$kv" ]; then continue; fi
  if [ $FIRST -eq 0 ]; then KVS_JSON+=","; fi
  FIRST=0
  KVS_JSON+=$(jq -nc --arg k "$KEY" --arg v "$VAL" '[$k, $v]')
done
KVS_JSON+=']'

jq_patch "
  .result = (.result // {})
  | reduce \$kvs[] as \$pair (.; .result[\$pair[0]] = \$pair[1])
  | .updated_at = \"$(now_iso)\"
" --argjson kvs "$KVS_JSON"

echo "[result] $*"
