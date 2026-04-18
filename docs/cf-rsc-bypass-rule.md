# Cloudflare Cache Rule — Bypass RSC requests

## Why

Next.js App Router sends a second kind of request for every page: an RSC
(React Server Component) payload used by client-side navigation. These
requests carry either header:

- `RSC: 1`
- `Next-Router-Prefetch: 1`

The response has `Content-Type: text/x-component` and a tree-serialized
payload — NOT HTML.

Cloudflare's default cache keying is URL-based. It ignores the origin's
`Vary: rsc` header unless a Cache Rule explicitly tells it to. Result:
one RSC prefetch request can poison the cache for that URL, and every
subsequent normal browser request to that URL receives the RSC payload
as the initial HTML response — the user sees a blob of JSON-ish text.

This happened on 2026-04-18 shortly after a deploy (SEV1, `/en` affected
for ~5 min until manual Purge Everything).

## Fix

Add a Cloudflare Cache Rule that BYPASSES the cache whenever the RSC
header is present. RSC responses are cheap to regenerate (they're just
the server component tree) so skipping edge cache for them is fine —
and it prevents them from ever occupying a cache slot that a normal
request would hit.

## How to add (via Cloudflare Dashboard)

1. Go to your zone: **zcybernews.com**
2. **Caching** → **Cache Rules** → **Create rule**
3. Name: `Bypass cache for Next.js RSC requests`
4. When incoming requests match (use the **Expression Editor**):

   ```
   (any(http.request.headers["rsc"][*] eq "1")) or (any(http.request.headers["next-router-prefetch"][*] eq "1")) or (any(http.request.headers["next-router-state-tree"][*] ne ""))
   ```

   Plain English: if ANY of these headers is set, this is an RSC request.

5. Then (the action):
   - **Cache eligibility:** `Bypass cache`
6. **Deploy**

Place this rule ABOVE the existing "cache HTML" rule so it short-circuits
before the cache-HIT rule evaluates.

## How to verify

After deploy:

```bash
# Normal request — should be cacheable
curl -I https://zcybernews.com/en | grep -iE "^(content-type|cf-cache-status)"
# Expect: Content-Type: text/html; cf-cache-status: HIT (on 2nd req)

# Simulated RSC request — should bypass cache
curl -I -H "RSC: 1" https://zcybernews.com/en | grep -iE "^(content-type|cf-cache-status)"
# Expect: Content-Type: text/x-component; cf-cache-status: BYPASS (or DYNAMIC)
```

If the RSC request shows `cf-cache-status: HIT` or `MISS` that becomes
`HIT` on retry — the rule is NOT working and the cache can poison again.

## API alternative (for IaC later)

If we ever move CF config to code, this Cache Rule expression is:

```json
{
  "expression": "(any(http.request.headers[\"rsc\"][*] eq \"1\")) or (any(http.request.headers[\"next-router-prefetch\"][*] eq \"1\")) or (any(http.request.headers[\"next-router-state-tree\"][*] ne \"\"))",
  "action": "set_cache_settings",
  "action_parameters": {
    "cache": false
  },
  "description": "Bypass cache for Next.js RSC requests"
}
```

Can be applied via `wrangler` or the CF API once we move to IaC. For
now, manual dashboard config is the fastest path.

## Related

- `docs/redesign-phase-2-spec.md` — CF cache HIT achieved via disabling
  `NEXT_LOCALE` Set-Cookie
- Memory: `session_log_2026_04_18_sev3_cache.md` — prior CF cache work
