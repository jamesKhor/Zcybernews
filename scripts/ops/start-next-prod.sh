#!/usr/bin/env bash
set -euo pipefail

cd /home/zcybernews/zcybernews

PORT="${PORT:-3000}"

# exec replaces this shell so PM2 owns the actual Next.js server process.
exec ./node_modules/.bin/next start -p "$PORT"
