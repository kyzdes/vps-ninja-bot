#!/usr/bin/env bash
# ask-user.sh — append a question to the job file, transition the job
# to awaiting-answers, then block (polling the file) until the dashboard
# posts an answer. Prints the answer on stdout for Claude to consume.
#
# Usage:
#   ask-user.sh <question-id> "<label>" text  "<placeholder>" "<hint>"
#   ask-user.sh <question-id> "<label>" select "opt1,opt2,opt3"  "<hint>"
#
# Examples:
#   ANSWER=$(bash ask-user.sh q_api_url "NEXT_PUBLIC_API_URL" text "https://api.example.com" "Build-time public API endpoint")
#   ANSWER=$(bash ask-user.sh q_db "Database" select "postgres 16,sqlite,none" "Pick the DB engine")
#
# Behavior:
#   - If the question id already exists in job.questions[] AND has an
#     answer, immediately returns it (idempotent: re-invoking the
#     helper after a resume returns the stored answer).
#   - Otherwise appends a new question, flips status to
#     awaiting-answers, then polls every 500ms for an answer.
#   - Times out after 15 minutes (POLL_TIMEOUT_S env can override).

source "$(dirname "$0")/_jq-patch.sh"

QID="${1:?Usage: ask-user.sh <id> <label> <type> <options-or-placeholder> [hint]}"
LABEL="${2:?missing label}"
TYPE="${3:?missing type (text|select)}"
EXTRA="${4:-}"     # options csv for select; placeholder for text
HINT="${5:-}"

POLL_TIMEOUT="${POLL_TIMEOUT_S:-900}"
POLL_INTERVAL="${POLL_INTERVAL_S:-0.5}"

# Check if question already answered (idempotent resume)
EXISTING=$(jq -r --arg id "$QID" '.questions // [] | map(select(.id == $id and .answer != null and .answer != "")) | .[0].answer // empty' "$JOB_PATH")
if [ -n "$EXISTING" ]; then
  printf '%s' "$EXISTING"
  exit 0
fi

# Build the question object
if [ "$TYPE" = "select" ]; then
  OPTS_JSON=$(printf '%s' "$EXTRA" | jq -Rsc 'split(",") | map(gsub("^ +| +$"; ""))')
  Q_JSON=$(jq -nc \
    --arg id "$QID" --arg label "$LABEL" --arg type "$TYPE" \
    --arg hint "$HINT" --argjson options "$OPTS_JSON" \
    '{id:$id, label:$label, type:$type, options:$options, hint:$hint, required:true, answer:null}')
else
  Q_JSON=$(jq -nc \
    --arg id "$QID" --arg label "$LABEL" --arg type "$TYPE" \
    --arg placeholder "$EXTRA" --arg hint "$HINT" \
    '{id:$id, label:$label, type:$type, placeholder:$placeholder, hint:$hint, required:true, answer:null}')
fi

# Append question (deduping by id), flip status, mark questions step active
jq_patch "
  .questions = ((.questions // []) | map(select(.id != \$qid)) + [\$q])
  | .status = \"awaiting-answers\"
  | .steps |= map(
      if .id == \"questions\" then .status = \"active\"
      elif .status == \"active\" then .status = \"done\"
      else . end)
  | .log += [{ t: \"$(now_t)\", kind: \"warn\", text: (\"Awaiting answer: \" + \$label) }]
  | .updated_at = \"$(now_iso)\"
" --arg qid "$QID" --arg label "$LABEL" --argjson q "$Q_JSON"

# Poll for answer
START=$(date +%s)
while true; do
  ANSWER=$(jq -r --arg id "$QID" '.questions[] | select(.id == $id) | .answer // empty' "$JOB_PATH")
  if [ -n "$ANSWER" ]; then
    # Got it — log and return
    jq_patch "
      .log += [{ t: \"$(now_t)\", kind: \"ok\", text: (\"Got answer for \" + \$label) }]
      | .updated_at = \"$(now_iso)\"
    " --arg label "$LABEL"
    printf '%s' "$ANSWER"
    exit 0
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$POLL_TIMEOUT" ]; then
    jq_patch "
      .status = \"error\"
      | .error = (\"Timed out waiting for answer to \" + \$label)
      | .log += [{ t: \"$(now_t)\", kind: \"error\", text: (\"Timed out (\" + (\$timeout|tostring) + \"s) waiting for: \" + \$label) }]
    " --arg label "$LABEL" --argjson timeout "$POLL_TIMEOUT"
    echo "timed out waiting for answer to $QID after ${POLL_TIMEOUT}s" >&2
    exit 124
  fi
  sleep "$POLL_INTERVAL"
done
