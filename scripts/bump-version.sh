#!/usr/bin/env bash
# bump-version.sh <X.Y.Z> — set the version at every echo site, re-sync the
# AGENTS/GEMINI mirrors, then verify with check-version-sync.sh. WS6 / T39.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2
NEW="${1:?usage: bump-version.sh <X.Y.Z>}"
echo "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "bad version: $NEW (want X.Y.Z)"; exit 2; }

# JSON manifests (SSOT first). The "v"-prefixed sites are edited by the python below.
tmp=$(mktemp); jq --arg v "$NEW" '.version=$v' .claude-plugin/plugin.json > "$tmp" && mv "$tmp" .claude-plugin/plugin.json
tmp=$(mktemp); jq --arg v "$NEW" '.version=$v' gemini-extension.json      > "$tmp" && mv "$tmp" gemini-extension.json

# Text sites (portable in-place edits).
python3 - "$NEW" <<'PY'
import re, sys, glob
NEW = sys.argv[1]; V = "v" + NEW
def sub(path, pat, repl):
    try: s = open(path, encoding="utf-8").read()
    except FileNotFoundError: return
    s2 = re.sub(pat, repl, s)
    if s2 != s: open(path, "w", encoding="utf-8").write(s2)
sub("README.md", r"version-v[0-9]+\.[0-9]+\.[0-9]+", "version-" + V)
sub("mcp-server/ui-server/routes/health.js", r'version: "v[0-9]+\.[0-9]+\.[0-9]+"', 'version: "%s"' % V)
sub("dokpilot-ui/assets/app.js", r'version:"v[0-9]+\.[0-9]+\.[0-9]+"', 'version:"%s"' % V)
for f in glob.glob("dokpilot-ui/*.html"):
    sub(f, r'class="sb-ver">v[0-9]+\.[0-9]+\.[0-9]+', 'class="sb-ver">' + V)
    sub(f, r'(id="ver"[^>]*>)v[0-9]+\.[0-9]+\.[0-9]+', lambda m: m.group(1) + V)
PY

# Keep AGENTS.md / GEMINI.md mirrors of SKILL.md in sync.
bash scripts/sync-mirrors.sh >/dev/null 2>&1 || true

echo "bumped to $NEW — verifying…"
exec bash scripts/check-version-sync.sh
