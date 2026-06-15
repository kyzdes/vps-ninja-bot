#!/usr/bin/env bash
# scan-repo.sh — shallow-clone an untrusted application repo for Phase-A analysis.
#
# WS1 / D-019: the two-phase deploy worker NEVER lets the deploy phase read raw
# repo bytes. This script does the ONE privileged thing Phase A needs — a shallow
# clone into a throwaway directory — and does nothing else (it does NOT read file
# contents; the read-only Phase A claude does that, then emits a validated manifest).
#
# It deliberately does NOT run any code from the repo (no install, no build, no
# hooks beyond what `git clone` itself does). The URL is passed to git as an argv,
# never interpolated into a shell, so a hostile repo URL cannot inject a command.
#
# Usage:
#   scan-repo.sh <repo_url> [branch] [dest_base_dir]
#     repo_url   https://github.com/owner/repo(.git)  or  git@host:owner/repo.git
#     branch     optional; if omitted, the remote default branch (HEAD) is used.
#                if given and clone fails, main<->master are tried as a convenience.
#     dest_base  optional base dir for the throwaway clone (default: $TMPDIR).
#
# Emits JSON on stdout:  {"clone_dir":"...","branch":"...","head_sha":"..."}
# Exit codes: 0 ok | 1 bad args | 2 clone failed
set -euo pipefail

REPO_URL="${1:?usage: scan-repo.sh <repo_url> [branch] [dest_base_dir]}"
BRANCH="${2:-}"
DEST_BASE="${3:-${TMPDIR:-/tmp}}"

# Light URL sanity check (the ui-server validates more strictly upstream).
case "$REPO_URL" in
  https://*|http://*|git@*) : ;;
  *) echo '{"error":"bad-repo-url","hint":"expected https://, http:// or git@ URL"}' >&2; exit 1 ;;
esac

CLONE_DIR="$(mktemp -d "${DEST_BASE%/}/dokpilot-clone.XXXXXX")"

# Disable any interactive credential prompt and repo-supplied hooks influence.
export GIT_TERMINAL_PROMPT=0

_clone() {
  # $1 = branch (may be empty -> remote default HEAD)
  if [ -n "$1" ]; then
    git clone --depth 1 --single-branch --branch "$1" --no-tags -- "$REPO_URL" "$CLONE_DIR" >/dev/null 2>&1
  else
    git clone --depth 1 --single-branch --no-tags -- "$REPO_URL" "$CLONE_DIR" >/dev/null 2>&1
  fi
}

if _clone "$BRANCH"; then
  :
else
  # Convenience fallback only when an explicit main/master was requested.
  rm -rf "${CLONE_DIR:?}"/* "${CLONE_DIR:?}"/.[!.]* 2>/dev/null || true
  ALT=""
  case "$BRANCH" in
    main)   ALT="master" ;;
    master) ALT="main" ;;
  esac
  if [ -n "$ALT" ] && _clone "$ALT"; then
    BRANCH="$ALT"
  else
    rm -rf "$CLONE_DIR"
    echo "{\"error\":\"clone-failed\",\"hint\":\"could not shallow-clone the repo (check URL/branch/access)\"}" >&2
    exit 2
  fi
fi

HEAD_SHA="$(git -C "$CLONE_DIR" rev-parse HEAD 2>/dev/null || echo "")"
ACTUAL_BRANCH="$(git -C "$CLONE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
[ -z "$ACTUAL_BRANCH" ] || [ "$ACTUAL_BRANCH" = "HEAD" ] && ACTUAL_BRANCH="${BRANCH:-HEAD}"

# Build the JSON with jq if present (safe escaping); else a minimal manual fallback.
if command -v jq >/dev/null 2>&1; then
  jq -nc --arg dir "$CLONE_DIR" --arg branch "$ACTUAL_BRANCH" --arg sha "$HEAD_SHA" \
    '{clone_dir:$dir, branch:$branch, head_sha:$sha}'
else
  printf '{"clone_dir":"%s","branch":"%s","head_sha":"%s"}\n' "$CLONE_DIR" "$ACTUAL_BRANCH" "$HEAD_SHA"
fi
