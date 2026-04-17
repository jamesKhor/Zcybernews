# Cloudflare Cache Setup — P0 2026-04-18

## What we shipped in code (`4f886ff` + this commit)

Next.js now emits correct `Cache-Control` headers for every route type:

| Route                                         | Cache-Control emitted                                    |
| --------------------------------------------- | -------------------------------------------------------- |
| `/en/*`, `/zh/*` (content)                    | `public, s-maxage=3600, stale-while-revalidate=86400`    |
| `/en/salary`, `/zh/salary`                    | `public, s-maxage=21600, stale-while-revalidate=86400`   |
| `/sitemap.xml`, `/robots.txt`                 | `public, s-maxage=3600, stale-while-revalidate=86400`    |
| `/api/feed`, `/api/wechat`                    | `public, s-maxage=3600, stale-while-revalidate=86400`    |
| `/_next/static/*`                             | `public, max-age=31536000, immutable`                    |
| `/images/*`                                   | `public, max-age=604800, stale-while-revalidate=2592000` |
| `/admin/*`, `/api/admin/*`, `/api/revalidate` | `private, no-cache, no-store, must-revalidate`           |

This alone should lift cache hit rate from 7.6% → 40-50% because Cloudflare will now **respect** the `public, s-maxage=…` directives.

## What the operator needs to do on Cloudflare dashboard

Cloudflare defaults to "respect origin cache headers" for HTML. That's ✅ now that origins emit proper values. But Cloudflare also has **Cache Rules** — a UI feature for edge-side cache overrides that can push hit rate to **60-75%**.

### Step 1 — Verify caching is not being actively bypassed

Cloudflare's UI evolved in 2024 — "Respect Strong ETags" was removed as a
toggle (it's now default-on behavior). What still matters:

1. Cloudflare dashboard → `zcybernews.com` → **Caching** → **Configuration**
2. Confirm each setting:
   - **Caching Level** = `Standard`
     (not "Bypass" or "No query string" — both cripple cache hits)
   - **Browser Cache TTL** = `Respect Existing Headers`
     (so Cloudflare honors the browser-side `max-age` we emit)
   - **Development Mode** = `OFF`
     (this is a 3-hour timer that bypasses ALL cache — sometimes
     accidentally left on after debugging)
   - **Always Online™** = `On` (if visible; optional but nice — serves
     a cached copy when origin is down)

If "Respect Strong ETags" isn't visible, that's expected — it's on by
default now and no longer surfaced in the UI.

### Step 2 — Create a Cache Rule for HTML pages (the big win)

Cloudflare's default is to NOT cache HTML (dynamic content). Our `Cache-Control` directive asks it to. But a Cache Rule makes this explicit:

1. Cloudflare dashboard → `zcybernews.com` → **Caching** → **Cache Rules** → **Create rule**
2. **Rule name**: `Cache HTML content pages`
3. **If** (use Edit expression):
   ```
   (http.host eq "zcybernews.com" and starts_with(http.request.uri.path, "/en/"))
   or (http.host eq "zcybernews.com" and starts_with(http.request.uri.path, "/zh/"))
   or (http.host eq "zcybernews.com" and http.request.uri.path eq "/en")
   or (http.host eq "zcybernews.com" and http.request.uri.path eq "/zh")
   ```
4. **Then**:
   - **Cache eligibility**: `Eligible for cache`
   - **Edge TTL**: `Use cache-control header if present, bypass cache if not`
     - (This is the key setting — matches what we're now emitting)
   - **Browser TTL**: `Respect origin TTL`
5. **Save and deploy**

Expected impact: CF cache hit rate → 65-75% for article page HTML.

### Step 3 — Create a Cache Rule for sitemap + feeds

Same UI, new rule:

1. **Rule name**: `Cache sitemap and feeds`
2. **If**:
   ```
   (http.host eq "zcybernews.com" and http.request.uri.path eq "/sitemap.xml")
   or (http.host eq "zcybernews.com" and http.request.uri.path eq "/robots.txt")
   or (http.host eq "zcybernews.com" and http.request.uri.path eq "/api/feed")
   or (http.host eq "zcybernews.com" and http.request.uri.path eq "/api/wechat")
   ```
3. **Then**:
   - Cache eligibility: `Eligible for cache`
   - Edge TTL: `Use cache-control header if present`
   - Browser TTL: `Respect origin TTL`

### Step 4 — Create a BYPASS rule for admin (safety net)

Even though we emit `private, no-store` on `/admin/*`, add an explicit CF bypass as a safety net. Misconfigured CF rules have leaked admin sessions before — defense in depth:

1. **Rule name**: `NEVER cache admin or api/admin`
2. **If**:
   ```
   starts_with(http.request.uri.path, "/admin/")
   or starts_with(http.request.uri.path, "/api/admin/")
   or http.request.uri.path eq "/api/revalidate"
   ```
3. **Then**:
   - Cache eligibility: `Bypass cache`
4. **Order**: drag this rule to the TOP so it evaluates first.

### Step 5 — Optional CF cache purge on publish

For instant (vs. 1-hour) content updates after admin publishes, set these env vars on the VPS:

```bash
# Create fine-grained API token in Cloudflare dashboard:
# My Profile → API Tokens → Create Token → Custom token
# Permissions: Zone → Cache Purge → Purge
# Zone Resources: Include → zcybernews.com
CLOUDFLARE_API_TOKEN=<your-token>

# Zone ID from Cloudflare dashboard overview page (right sidebar)
CLOUDFLARE_ZONE_ID=<your-zone-id>
```

Append to `/home/zcybernews/zcybernews/.env.local` on VPS, then:

```bash
pm2 reload zcybernews --update-env
```

The `/api/revalidate` endpoint will then purge CF cache alongside Next.js ISR invalidation whenever admin publishes. Without these vars, purge is silently skipped (admin publishes still work — content just takes ≤1h to appear globally).

## Verification (after CF rules save)

```bash
# Expect: first hit MISS, second hit HIT within 10 seconds
curl -sI https://zcybernews.com/en/salary | grep -iE "cf-cache-status|cache-control"
curl -sI https://zcybernews.com/en/salary | grep -iE "cf-cache-status|cache-control"
```

Look for:

- `cf-cache-status: HIT` (after 2nd request) ← the big win
- `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`

## Monitoring

CF dashboard → Analytics → Traffic → watch for:

- **Cached requests %** climbing from 7.6% → 60%+ over 24-48h
- **Bandwidth saved** growing from 20% → 60%+
- **Origin requests** dropping proportionally

If cache hit rate stays stuck below 40% after rules are live, check:

1. Are there a lot of unique URL variants? (`?utm_source=...` makes every URL unique and uncacheable at default settings — can be fixed with a `Remove query parameters` rule)
2. Is Bot Fight Mode challenging legitimate visitors? Bypass cache for challenges.
3. Is a Worker intercepting requests? Check `Workers & Pages`.
