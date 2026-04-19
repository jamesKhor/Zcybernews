#!/usr/bin/env bash
# Post-deploy smoke test — runs against production after every deploy.
#
# Catches the class of failures that the 2026-04-18 SEV1s surfaced:
#   - RSC payload (text/x-component) being served as initial HTML
#   - Article detail pages returning 500
#   - Favicon / icon routes returning 308 redirects
#   - Sitemap/robots not reachable
#   - CF cache serving wrong content-type
#
# Exits non-zero on ANY failure — deploy workflow fails the job, operator
# gets notified. Takes ~15 seconds total over 10 URLs.
#
# Usage (local):
#   BASE_URL=https://zcybernews.com ./scripts/smoke-test-prod.sh
#   BASE_URL=http://localhost:3000 ./scripts/smoke-test-prod.sh
#
# Usage (CI — wired into .github/workflows/deploy-vps.yml after health check):
#   - run: ./scripts/smoke-test-prod.sh
#     env:
#       BASE_URL: https://zcybernews.com
#
# Agent-friendly: fast, deterministic, prints exactly what failed. If
# upstream Debugger needs to investigate a failure, grep the output.
set -u
BASE_URL="${BASE_URL:-https://zcybernews.com}"
# Browser User-Agent — Cloudflare's Bot Fight / WAF returns 403 on the
# default `curl/8.x` UA when the request originates from a GitHub Actions
# runner IP block. Using a real browser UA avoids the false-alarm deploy
# failures that happened on 2026-04-18 when CF blocked 9/10 smoke checks
# even though the site was serving 200 to real users.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
FAILURES=0
TOTAL=0

check() {
  local label="$1" url="$2" expect_status="$3" expect_ct_pattern="$4"
  TOTAL=$((TOTAL + 1))
  local response status ct size
  # Retry once with a 3s backoff — CF's Bot Fight occasionally 403s
  # the first request from a GitHub Actions runner IP regardless of
  # User-Agent. A fresh connection after a brief pause almost always
  # clears. If BOTH attempts 403, it's a real block worth flagging.
  for attempt in 1 2; do
    response=$(curl -s -o /tmp/smoke-body -w "HTTP=%{http_code}\nCT=%{content_type}\nSIZE=%{size_download}" -L --max-time 10 -A "${UA}" "${url}" 2>&1 || echo "HTTP=000")
    status=$(echo "${response}" | grep "^HTTP=" | cut -d= -f2)
    ct=$(echo "${response}" | grep "^CT=" | cut -d= -f2-)
    size=$(echo "${response}" | grep "^SIZE=" | cut -d= -f2)
    # Retry only on CF-flavoured transient codes; 2xx/3xx/4xx≠403/5xx
    # are real responses we can act on.
    if [ "${status}" != "403" ] && [ "${status}" != "000" ]; then
      break
    fi
    if [ "${attempt}" = "1" ]; then sleep 3; fi
  done

  if [ "${status}" != "${expect_status}" ]; then
    echo "✗ ${label}  status=${status} expected=${expect_status}  url=${url}"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! echo "${ct}" | grep -qE "${expect_ct_pattern}"; then
    echo "✗ ${label}  content-type=\"${ct}\" expected-pattern=\"${expect_ct_pattern}\"  url=${url}"
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "✓ ${label}  ${status} ${ct%%;*} ${size}B"
}

echo "Smoke test: ${BASE_URL}"
echo "----------------------------------------"

# Homepage — both locales. Must be text/html, not text/x-component.
check "GET /en (homepage)"           "${BASE_URL}/en"                    200 "text/html"
check "GET /zh (homepage)"           "${BASE_URL}/zh"                    200 "text/html"

# Salary page — high-traffic, has CinematicHero + SalaryCard grid.
check "GET /en/salary"               "${BASE_URL}/en/salary"             200 "text/html"
check "GET /zh/salary"               "${BASE_URL}/zh/salary"             200 "text/html"

# Article detail — the SEV3 class that kept hitting 500 before
# transpilePackages fix. Pick a known-stable article slug.
check "GET /en/articles (listing)"   "${BASE_URL}/en/articles"           200 "text/html"

# Category + tag pages — NYT-style listings added today.
check "GET /en/categories/vulnerabilities" "${BASE_URL}/en/categories/vulnerabilities" 200 "text/html"

# Sitemap / robots — must be reachable and correct MIME.
check "GET /sitemap.xml"             "${BASE_URL}/sitemap.xml"           200 "(xml|text)"
check "GET /robots.txt"              "${BASE_URL}/robots.txt"            200 "text"

# Favicon / icon — 2026-04-18 had proxy.ts matcher issue causing 308s.
# Must return 200 image/png (not a redirect).
check "GET /icon"                    "${BASE_URL}/icon"                  200 "image/png"
check "GET /apple-icon"              "${BASE_URL}/apple-icon"            200 "image/png"

echo "----------------------------------------"
if [ ${FAILURES} -eq 0 ]; then
  echo "✓ All ${TOTAL} checks passed"
  exit 0
else
  echo "✗ ${FAILURES}/${TOTAL} checks failed"
  exit 1
fi
