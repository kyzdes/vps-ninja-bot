#!/usr/bin/env bash
# update-status.sh — transition the job to a new lifecycle state.
# Also flips the matching step's status (active for new, done for previous active).
#
# Usage: update-status.sh <new-status>
#   States: analyzing-repo | analyzing-stack | awaiting-answers | deploying | wait-dns | finalizing | done | done-unconfirmed | error
#
# NOTE: the worker only ever sets `done`/`error` here — `done-unconfirmed` is set
# server-side by claude-worker's finalize (WS3). It's accepted here DEFENSIVELY so
# this helper can never hard-reject a valid terminal state (treated like `done`).

source "$(dirname "$0")/_jq-patch.sh"

NEW="${1:?Usage: update-status.sh <new-status>}"

# Map status → which step is now "active"
case "$NEW" in
  analyzing-repo)              STEP="analyze" ;;
  analyzing-stack)             STEP="detect" ;;
  awaiting-answers)            STEP="questions" ;;
  deploying)                   STEP="deploy" ;;
  wait-dns)                    STEP="dns" ;;
  finalizing)                  STEP="finalize" ;;
  done|done-unconfirmed|error) STEP="" ;;
  *) echo "unknown status: $NEW" >&2; exit 2 ;;
esac

# Walk steps[]: mark previous-active as done, mark new step active.
# Terminal states (done/error) mark all remaining pending steps as done (success) or leave them (error).
jq_patch "
  .status = \"$NEW\"
  | .updated_at = \"$(now_iso)\"
  | if \"$STEP\" == \"\" then
      if \"$NEW\" == \"done\" or \"$NEW\" == \"done-unconfirmed\" then
        .steps |= map(if .status == \"pending\" or .status == \"active\" then .status = \"done\" else . end)
      else . end
    else
      .steps |= map(
        if .id == \"$STEP\" then .status = \"active\"
        elif .status == \"active\" then .status = \"done\"
        else . end)
    end
"

echo "[status] $NEW"
