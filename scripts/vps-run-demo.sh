#!/bin/bash
# Cron entry point for the public demo room only, once a minute.
#
#   crontab:  * * * * * /home/ubuntu/arisan-crank/run-demo.sh >> ~/arisan-crank/demo.log 2>&1
#
# The demo room runs one-minute rounds so a visitor can finish a whole turn while
# they are still looking at it. That only works if our seat is paid, and the pot
# collected when the draw lands on us, within seconds rather than at the top of
# the next hour — which is why this is separate from the hourly crank.
#
# `--only demo` keeps it to that one circle instead of walking a hundred and
# fifty wallets every minute. Its own lock file lets it run while the hourly
# crank is mid-pass.
set -uo pipefail
cd "$(dirname "$0")" || exit 1

NODE=$(command -v node || echo /usr/bin/node)

exec /usr/bin/flock -n /tmp/arisan-demo.lock bash -c "
  cd '$(pwd)'
  '$NODE' scripts/crank-circles.mjs --only demo
  '$NODE' scripts/recycle-circles.mjs --only demo
"
