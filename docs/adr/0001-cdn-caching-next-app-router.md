# ADR-0001: CDN caching strategy for self-hosted Next.js 16 App Router behind Cloudflare

- **Status:** Accepted
- **Date:** 2026-04-18
- **Author:** Vincent (Principal Systems Architect)
- **Decision-makers:** Founder, Raymond (Engineering)
- **Verdict (TL;DR):** **Ship the fix.** Origin-side `Cache-Control: private, no-store` on RSC-flagged requests plus the CF Cache Rule as belt-and-braces is the correct, industry-standard pattern for our traffic profile. Hold the bigger architectural change (Workers cache-key augmentation, edge runtime, Fastly) until we cross 10k sessions/day or ship authenticated personalization.

---

## Context

### The SEV1 (2026-04-18)

Cloudflare cached a Next.js RSC payload (`Content-Type: text/x-component`) under the URL `/en`. The first request that hit the cold edge was a `<Link>` prefetch from a React Server Component, which sends `RSC: 1` and expects the flight payload, not HTML. CF stored that response. Every subsequent browser navigation to `/en` received the serialized RSC blob as the initial document. Browsers rendered the raw flight payload as text. Five minutes of broken homepage until manual "Purge Everything".

### The mechanism (why this is a known foot-gun, not a bug)

1. **Next.js emits identical `Cache-Control` headers** for HTML and RSC responses on the same URL. Both are `public, s-maxage=3600, stale-while-revalidate=...` under ISR.
2. **Next.js signals the difference via request/response `Vary` on custom headers** — `RSC`, `Next-Router-Prefetch`, `Next-Router-State-Tree`, `Next-Router-Segment-Prefetch`.
3. **Cloudflare's cache key is URL + method + a small set of standard headers** (Host, Accept-Encoding, a configurable subset). **CF ignores `Vary` on non-standard request headers by default.** This is documented behavior and matches Akamai and Fastly out of the box.
4. Result: two distinct response bodies compete for one cache key. Whichever lands first wins. If a prefetch arrives before a user, the cache is poisoned.

This is not a Next.js bug and it is not a Cloudflare bug. It is a **contract mismatch between a framework that assumes `Vary`-aware caches and a CDN class that does not parse custom-header `Vary` for cache-key derivation**. The same foot-gun exists on Akamai, Fastly (without VCL), CloudFront, and every other generic CDN — Vercel papers over it in their own infrastructure by baking the RSC dimension into the cache key at their edge.

### Our topology today

```
Browser
  |
  v
Cloudflare (orange cloud, free/pro tier)
  - Cache Rule: cache eligible HTML, TTL from origin s-maxage
  - Single cache key per URL (default)
  |
  v
Malaysia VPS (Evoxt, 2 GB / 1 vCPU)
  - Nginx :443 -> Node :3000
  - PM2 cluster, 2 workers
  - Next.js 16 App Router, ISR (articles 1h, /salary 24h)
  - Content committed as MDX, memoized via mtime-keyed Map
```

Traffic profile: **>90% initial HTML from SEO + social referrers** (Google, Baidu, XHS, WeChat). Client-side SPA navigation is a minority and by definition only matters for users already on the site. Authenticated surface is `/admin/**` only, already dynamic.

---

## Decision

**Ship the origin-side fix that was shipped locally in this session.**

1. **`proxy.ts` stamps `Cache-Control: private, no-store`** when the request carries any of:
   - `RSC`
   - `Next-Router-Prefetch`
   - `Next-Router-State-Tree`
   - `Next-Router-Segment-Prefetch`

   This makes RSC responses structurally ineligible for any shared cache — CF, any intermediary, any browser back-forward cache. The RSC payload is delivered directly from origin, every time, to the client that asked for it. Client-side SPA navigation still works (browser fetch succeeds; only shared caches are excluded).

2. **Cloudflare Cache Rule: bypass cache when `RSC` header is present.** Documented in `docs/cf-rsc-bypass-rule.md`. This is belt-and-braces; even if origin headers regress in a future Next.js version, CF will not store RSC responses. Two independent mechanisms have to both fail before a poisoning recurs.

3. **Keep the existing Cache Rule for HTML** — honor origin `s-maxage`, cache at edge, high hit ratio. No change to the happy path.

### Why this is the industry standard

Not the vendor-preferred path, the **actually-deployed** pattern on self-hosted App Router behind a generic CDN:

- **Shopify Hydrogen** (RSC-adjacent, Oxygen on Cloudflare Workers): custom cache-key logic in Workers that folds the RSC dimension into the key. They own both sides, so they do key augmentation. We don't own the edge runtime, so we do origin-side exclusion — the equivalent outcome with less moving parts.
- **Vercel's own infrastructure**: their edge network has a **first-party cache-key builder** that reads the Next.js router headers and splits the cache dimension. No public product exposes this. It is not `@cloudflare/next-on-pages`. It is not `standalone` + generic CDN. It is proprietary.
- **NYT, The Verge, various Next.js App Router deployments on Fastly**: they write **VCL** that reads the RSC header and injects it into `hash_data()` for key separation. This is the Fastly equivalent of a CF Worker. On Cloudflare free/pro with only Cache Rules available, **you cannot augment the cache key with a custom request header** — the rule engine lets you bypass, not segment. So the pattern reduces to: "bypass RSC, cache HTML." That is exactly our fix.
- **Notion, Linear, etc.**: largely SPA shells with API-backed personalization. They don't CDN-cache the HTML at all (`private, no-store` on the shell) and cache behind the API boundary. Not our model — we are a content site and we need HTML edge caching for SEO latency.

So: augment-the-key is only available to us if we introduce a Worker. Bypassing RSC at the edge is the standard pattern when the rule engine is all you have. We are doing the right thing.

### Secondary guardrails we should add in the same PR

- **Synthetic monitor**: fetch `/en` with `Accept: text/html` and assert `<!DOCTYPE html>` in the body. Run every 2 minutes from an off-net probe (GitHub Actions cron is fine). If we regress, we find out in ≤2 min instead of ≤5 min of user reports.
- **CF Status Code TTL rule already in place** (4xx/5xx = No cache) — keep it. Its sibling rule, "bypass on RSC header," is the new one.
- **Log assertion**: Nginx access log should count `text/x-component` responses served under HTML-shaped URLs. If that counter ever exceeds zero for non-prefetch clients, alert.

---

## Consequences

### What we gain

- **Mechanical elimination of the poisoning path.** Two independent layers (origin `no-store`, CF bypass rule) would both have to fail.
- **Zero change to the cached-HTML happy path.** Edge HIT ratio is unaffected. P50 TTFB unchanged.
- **No new infrastructure.** No Workers, no cache handler, no runtime migration. Cost delta: $0.
- **Debuggability.** `proxy.ts` is 20 lines. CF Cache Rule is one row in the dashboard. Any engineer can reason about this in 5 minutes.

### What we give up

- **RSC responses are not edge-cached.** Every client-side `<Link>` navigation round-trips to Malaysia. For a user in SG/MY this is ~50 ms; for a user in US-East it is ~250 ms. **We accept this.** Client-side nav is <10% of our traffic and the users doing it are already engaged. The alternative — cache-key augmentation via a Worker — costs engineering complexity that doesn't pay for itself below 10k sessions/day.
- **Slightly higher origin CPU** from serving uncached RSC on SPA nav. Negligible at current scale (2 GB VPS is 5-10% CPU average).
- **We are locked into "bypass, don't segment" until we adopt a Worker.** That's fine; see revisit triggers.

### What we watch

- **Synthetic monitor must pass continuously.** If it fails, fall back to "Purge Everything" and roll forward.
- **CF analytics: cache status distribution on `/en`, `/zh`, article routes.** We want HIT % stable around current numbers. A drop means the `Vary: RSC` dance somehow punched through — investigate.
- **Origin CPU + memory.** If RSC traffic ever becomes a meaningful fraction of our load (>20% of req), revisit the Worker path.

---

## Alternatives considered

| Option                                                                                                                     | Verdict                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CF cache-key augmentation via Rules UI**                                                                                 | **Not possible on current plan.** CF Rules can bypass, not segment on custom request headers. Would require a Worker. Rejected for "ship today."                                                                                                                                                                       |
| **CF Worker with custom cache-key (read `RSC` header, fold into key via `cache.put(new Request(url + '?__rsc=1'), ...)`)** | Correct long-term pattern. ~80 lines of Worker code. $5/mo minimum on Workers Paid (10M req free, then $0.30/M). **Defer** until traffic or team bandwidth justifies. This is the right answer at 10k sessions/day.                                                                                                    |
| **`@cloudflare/next-on-pages` / OpenNext Cloudflare adapter**                                                              | Full re-platform to Workers runtime. Node APIs we rely on (filesystem-backed MDX loader, memoized `Map`, `gray-matter`, `rehype-highlight` plugin chain) either don't work or need rewrites. Build complexity rises sharply. **Rejected** — the Malaysia VPS is not the bottleneck.                                    |
| **Move to Vercel**                                                                                                         | Their edge silently handles RSC cache-key separation. "Fixes" the problem by outsourcing it. But: $20/mo Pro minimum, egress pricing at scale, loss of VPS-local AI pipeline ergonomics, and we just invested in the VPS zero-downtime deploy rig. **Rejected** unless Vercel becomes part of a larger strategic move. |
| **Edge runtime (`export const runtime = 'edge'`)**                                                                         | Does not change the CF cache-key problem — an edge-runtime response still flows through the same CDN layer with the same cache rules. Also breaks our Node-only code (MDX pipeline, fs loader). **Irrelevant to this decision.**                                                                                       |
| **Fastly with VCL**                                                                                                        | Canonical solution: VCL reads `RSC` header, injects into `hash_data()`, HTML and RSC get separate keys, both cache. ~$50/mo floor, contract-oriented sales process, full CDN re-platform. **Overkill** at current scale; revisit at 50k+ sessions/day or if we need ESI/fragment caching for personalization.          |
| **Custom Next.js `cacheHandler`**                                                                                          | Wrong layer. `cacheHandler` controls ISR's internal render cache (the `.next/cache` layer), not edge cache-key derivation. Solves a different problem. **Rejected** as irrelevant to this incident.                                                                                                                    |
| **Disable ISR, go fully static (`output: 'export'`)**                                                                      | Breaks admin, AI routes, CVE proxy, search API, revalidation endpoint. **Not an option.**                                                                                                                                                                                                                              |
| **Disable RSC prefetching globally (`prefetch={false}` on all `<Link>`)**                                                  | Kills a real UX win (instant nav after hover) to work around a caching bug. Cargo-cult fix. **Rejected.**                                                                                                                                                                                                              |

---

## When to revisit

The current architecture is right for **200-2k articles, 500-5k sessions/day**. Inflection points on the 5-year trajectory:

### At ~10k sessions/day (6-12 months out)

- **Adopt a CF Worker with custom cache-key.** Fold `RSC` into the key so client-side SPA nav gets edge HITs too. This is ~80 lines of Worker code plus $5/mo floor. At this traffic, the CPU saved at origin pays for it, and P50 client-nav latency drops from ~250ms (US-East) to ~30ms.
- **Add CF Tiered Cache / Origin Shield.** Malaysia is a long haul for NA/EU users; a US shield reduces origin fanout on cold content.

### At ~50k sessions/day OR when we ship authenticated personalization (12-24 months)

- **Revisit Fastly.** VCL gives us fragment caching (ESI-style) so personalized surfaces (subscriber banner, saved articles, locale override) can compose into cached HTML. CF Workers can do this too with HTMLRewriter, so evaluate both.
- **Separate RSC-only origin** is premature even here — a single Next.js process handles both fine. Don't split until you have a reason, which you probably never will.

### At ~20k articles (18-36 months)

- **ISR `generateStaticParams` strategy needs review.** Today we prerender top 50 per locale and rely on `dynamicParams` for the tail. At 20k articles, cold-render latency on unpopular content matters — add a **scheduled warmup crawler** that hits long-tail URLs weekly so CF has cached bodies before humans arrive.
- **Memoized filesystem loader becomes a memory concern.** 20k articles × ~10KB parsed = 200 MB resident per PM2 worker. Either bump VPS RAM, add an LRU cap on the memo, or move content to a sqlite/Postgres index with on-demand load. Leaning LRU cap — simplest.
- **Consider moving from `content/` in Git to an object store (R2/S3) with a small index DB.** Git repo size at 20k MDX files + images is unwieldy for the AI pipeline, not for Next.js.

### At any point if we add a second origin region (DR or latency)

- **CF Load Balancer + session affinity is fine**, but revalidation webhooks (`/api/revalidate`) now have to fan out to all origins. Today it's a single curl; with two origins it's two curls. Not hard, just don't forget.

### Signals that force an immediate revisit regardless of traffic

- Any further cache-poisoning incident despite both layers in place
- Cloudflare changes `Vary` handling (unlikely but track their changelog)
- Next.js 17+ changes the RSC request-header contract (track their release notes)
- We introduce per-user personalization in the HTML shell (then we need fragment caching, period)

---

## References

- Next.js App Router data cache & `Vary` behavior: `node_modules/next/dist/docs/` (authoritative; use Context7 `/vercel/next.js` on every change)
- Cloudflare cache key documentation: https://developers.cloudflare.com/cache/how-to/cache-keys/
- Cloudflare cache rules (no custom-header segmentation on free/pro): https://developers.cloudflare.com/cache/how-to/cache-rules/
- Fastly VCL `hash_data()` pattern for RSC: community write-ups, e.g. Netlify's Next.js-on-Fastly adapter source
- Shopify Hydrogen cache-key handling: https://github.com/Shopify/hydrogen (search for `CacheCustom` / `cacheKey`)
- Our SEV1 mitigation log: MEMORY.md entry `session_log_2026_04_18_sev3_cache.md` and subsequent RSC poisoning notes
- Companion doc: `docs/cf-rsc-bypass-rule.md` (CF dashboard rule spec)
- Prior ADR context: `CLAUDE.md` Zero-Downtime Publishing Architecture section
