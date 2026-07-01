#!/usr/bin/env bash
# check-version-sync.sh — assert every version echo matches the single source of
# truth (.claude-plugin/plugin.json .version). Exits non-zero on ANY drift so CI
# fails a stale bump. Zero-dep beyond jq (a skill dependency). WS6 / T39.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

SSOT=$(jq -r '.version' .claude-plugin/plugin.json 2>/dev/null)   # e.g. 4.4.0
if [ -z "$SSOT" ] || [ "$SSOT" = "null" ]; then
  echo "FAIL: could not read version from .claude-plugin/plugin.json"; exit 2
fi
V="v$SSOT"                                                        # e.g. v4.4.0
fail=0
chk() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok    %-24s %s\n' "$1" "$3"
  else printf '  FAIL  %-24s want=%s got=%s\n' "$1" "$2" "$3"; fail=1; fi
}

echo "SSOT = $SSOT  (.claude-plugin/plugin.json)"
chk "gemini-extension.json" "$SSOT" "$(jq -r '.version' gemini-extension.json 2>/dev/null)"
chk "README badge"          "$V"    "$(grep -oE 'version-v[0-9]+\.[0-9]+\.[0-9]+' README.md 2>/dev/null | head -1 | sed 's/version-//')"
chk "health.js"             "$V"    "$(grep -oE 'version: "v[0-9]+\.[0-9]+\.[0-9]+"' mcp-server/ui-server/routes/health.js 2>/dev/null | grep -oE 'v[0-9.]+')"
chk "app.js MOCK meta"      "$V"    "$(grep -oE 'version:"v[0-9]+\.[0-9]+\.[0-9]+"' dokpilot-ui/assets/app.js 2>/dev/null | grep -oE 'v[0-9.]+')"
chk "settings #ver chip"    "$V"    "$(grep -oE 'id="ver"[^>]*>v[0-9]+\.[0-9]+\.[0-9]+' dokpilot-ui/settings.html 2>/dev/null | grep -oE 'v[0-9.]+$')"

# Every dashboard sidebar version chip must match.
total=0; bad=0
while IFS= read -r ver; do
  total=$((total + 1)); [ "$ver" = "$V" ] || bad=$((bad + 1))
done < <(grep -rhoE 'class="sb-ver">v[0-9]+\.[0-9]+\.[0-9]+' dokpilot-ui/ 2>/dev/null | grep -oE 'v[0-9.]+')
chk "sb-ver chips (of $total)" "0" "$bad"

if [ "$fail" -eq 0 ]; then echo "PASS: all version echoes == $SSOT"; exit 0
else echo "FAIL: version drift — run scripts/bump-version.sh $SSOT to fix"; exit 1; fi
