#!/usr/bin/env bash
# ZCyberNews — Automated AI content pipeline
# Runs on VPS via cron. Generates EN+ZH articles, rebuilds site, commits to GitHub.
#
# Usage: bash scripts/run-pipeline.sh [--max-articles=N]
# Default: 3 articles per run

set -euo pipefail

REPO_DIR="/home/zcybernews/zcybernews"
LOG_FILE="$REPO_DIR/.pipeline-logs/pipeline-$(date -u +%Y-%m-%d).log"
MAX_ARTICLES="${1:-3}"

# Strip --max-articles= prefix if passed directly
MAX_ARTICLES="${MAX_ARTICLES#--max-articles=}"

cd "$REPO_DIR"

mkdir -p "$(dirname "$LOG_FILE")"

exec >> "$LOG_FILE" 2>&1

echo ""
echo "=============================================="
echo "  ZCyberNews Pipeline — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================="

# 1. Pull latest code from GitHub
echo "[deploy] Pulling latest from main..."
git pull origin main --ff-only || {
  echo "[deploy] ⚠️  git pull failed — working tree may be dirty. Continuing with current code."
}

# 2. Run the AI pipeline
echo "[pipeline] Starting — max articles: $MAX_ARTICLES"
npx tsx --env-file=.env.local scripts/pipeline/index.ts --max-articles="$MAX_ARTICLES"
PIPELINE_EXIT=$?

if [ $PIPELINE_EXIT -ne 0 ]; then
  echo "[pipeline] ❌ Pipeline exited with code $PIPELINE_EXIT"
  exit $PIPELINE_EXIT
fi

# 3. Check if any new content was written
NEW_FILES=$(git status --short content/ 2>/dev/null | wc -l | tr -d ' ')

if [ "$NEW_FILES" -eq 0 ]; then
  echo "[pipeline] No new articles written (all stories already processed). Skipping rebuild."
  exit 0
fi

echo "[pipeline] $NEW_FILES new file(s) detected. Rebuilding site..."

# 4. Rebuild Next.js
HUSKY=0 npm run build

# 5. Restart PM2
pm2 restart zcybernews
echo "[deploy] ✅ PM2 restarted"

# 6. Commit new content to GitHub (keeps git in sync)
echo "[git] Committing new articles..."
git config user.name "zcybernews-bot"
git config user.email "bot@zcybernews.com"
git add content/ .pipeline-cache/ 2>/dev/null || true
git diff --staged --quiet || git commit -m "chore: ai pipeline $(date -u +%Y-%m-%dT%H:%M:%SZ) [skip ci]"
git push origin main || echo "[git] ⚠️  Push failed — will retry on next run"

echo "[pipeline] ✅ Done — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
