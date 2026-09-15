#!/bin/bash
# Cron entry point on the VPS: advance every seeded circle, then replace any
# that finished.
#
#   crontab:  0 * * * * /home/ubuntu/arisan-crank/run.sh >> ~/arisan-crank/crank.log 2>&1
#
# Both steps are guarded by the same conditions the program enforces, so a run
# with nothing due sends nothing. flock stops a slow run from overlapping the
# next one rather than queueing two cranks against the same circles.
#
# Order matters. Cranking first means a circle that completes its final round
# during this run gets replaced in the same run, instead of sitting finished for
# an hour with its collateral unlocked and its TVL counted as zero.
set -uo pipefail
cd "$(dirname "$0")" || exit 1

NODE=$(command -v node || echo /usr/bin/node)

run() {
  echo "=== $(date -u '+%Y-%m-%d %H:%M:%SZ') $1 ==="
  "$NODE" "scripts/$1"
}

exec /usr/bin/flock -n /tmp/arisan-crank.lock bash -c "
  $(declare -f run)
  NODE='$NODE'
  cd '$(pwd)'
  run crank-circles.mjs
  run recycle-circles.mjs
"
