#!/usr/bin/env bash
# ZCyberNews — Automated AI content pipeline
# Runs on VPS via cron. Generates EN articles, rebuilds site, commits to GitHub.
#
# Usage: bash scripts/run-pipeline.sh [--max-articles=N]
# Default: 3 articles per run

set -euo pipefail

REPO_DIR="/home/zcybernews/zcybernews"
LOG_FILE="$REPO_DIR/.pipeline-logs/pipeline-$(TZ='Asia/Singapore' date +%Y-%m-%d).log"
MAX_ARTICLES="${1:-3}"

# Strip --max-articles= prefix if passed directly
MAX_ARTICLES="${MAX_ARTICLES#--max-articles=}"

cd "$REPO_DIR"

mkdir -p "$(dirname "$LOG_FILE")"

# ── Log rotation: delete logs older than 30 days ──────────────────────────
find "$REPO_DIR/.pipeline-logs" -name "*.log" -mtime +30 -delete 2>/dev/null || true

exec >> "$LOG_FILE" 2>&1

# ── Load env vars (for API keys + Telegram config) ─────────────────────────
if [ -f "$REPO_DIR/.env.local" ]; then
  set -a
  # Use env parsing that handles $ in values (e.g. bcrypt hashes like $2b$12$...)
  while IFS='=' read -r key value; do
    # Skip comments and blank lines
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    # Trim whitespace from key
    key="${key//[[:space:]]/}"
    # Only export valid variable names
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$value"
  done < "$REPO_DIR/.env.local"
  set +a
fi

# ── Telegram notification helper ────────────────────────────────────────────
notify() {
  local message="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d parse_mode="HTML" \
      -d text="${message}" \
      -d disable_web_page_preview=true \
      > /dev/null 2>&1 || true
  fi
}

echo ""
echo "=============================================="
echo "  ZCyberNews Pipeline — $(TZ='Asia/Singapore' date '+%Y-%m-%d %H:%M:%S SGT')"
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
  notify "❌ <b>ZCyberNews Pipeline Failed</b>
Exit code: $PIPELINE_EXIT
Time: $(TZ='Asia/Singapore' date '+%H:%M SGT')"
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
NODE_OPTIONS="--max-old-space-size=512" HUSKY=0 npm run build

# 5. Restart PM2
pm2 restart zcybernews
echo "[deploy] ✅ PM2 restarted"

# 6. Commit new content to GitHub (keeps git in sync)
echo "[git] Committing new articles..."
git config user.name "zcybernews-bot"
git config user.email "bot@zcybernews.com"
git add content/ .pipeline-cache/ data/ 2>/dev/null || true
git diff --staged --quiet || git commit -m "chore: ai pipeline $(TZ='Asia/Singapore' date +%Y-%m-%dT%H:%M:%S+08:00) [skip ci]"
git push origin main || echo "[git] ⚠️  Push failed — will retry on next run"

# 7. Collect article titles for notification
ARTICLE_TITLES=$(git log -1 --name-only --pretty=format: -- content/en/ 2>/dev/null | \
  xargs -I{} basename {} .mdx 2>/dev/null | \
  head -5 | \
  sed 's/-/ /g; s/\b\(.\)/\u\1/g' | \
  sed 's/^/• /' || echo "")

ARTICLE_COUNT=$((NEW_FILES / 2))  # rough: EN + ZH pairs or just EN files
[ "$ARTICLE_COUNT" -lt 1 ] && ARTICLE_COUNT=$NEW_FILES

notify "✅ <b>ZCyberNews Published ${ARTICLE_COUNT} article(s)</b>
Time: $(TZ='Asia/Singapore' date '+%H:%M SGT')

${ARTICLE_TITLES}

🔗 https://zcybernews.com"

echo "[pipeline] ✅ Done — $(TZ='Asia/Singapore' date '+%Y-%m-%d %H:%M:%S SGT')"
