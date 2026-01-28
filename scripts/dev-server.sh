#!/usr/bin/env bash
set -euo pipefail
cd "/Users/joshmigliardi/Desktop/Codex Projects/market-fantasy"
export PATH="/Users/joshmigliardi/.nvm/versions/node/v20.19.6/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=true
export NEXT_TELEMETRY_DISABLED=1
exec /Users/joshmigliardi/.nvm/versions/node/v20.19.6/bin/node node_modules/next/dist/bin/next dev
