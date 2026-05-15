# SEO Indexability Root-Cause Audit — 2026-05-14

Owner: Alex program lane, Maya SEO, Vincent infra, Raymond engineering, Noah tracker

## Executive Summary

The May 14 Search Console export does not prove that the latest content commits broke SEO. It shows a very low-volume last-7-days performance window: 0 clicks and 41 impressions from 2026-05-06 through 2026-05-12. The stronger evidence is the Page Indexing screenshot: Google is still processing a large backlog of stale URL variants, old noindex states, thin tag/listing pages, and crawled-but-not-indexed article URLs.

Current production checks do not show an active Cloudflare-caused noindex or sitemap outage:

- `robots.txt` returns 200 and points to `https://zcybernews.com/sitemap.xml`.
- `sitemap.xml` returns 200, uses apex URLs only, contains fresh 2026-05-14 articles, and has no `www`, `/posts/`, or locale-less `/articles/` URLs in the sampled live parse.
- A known GSC article URL returns 200 with a self-canonical and no `noindex`.
- A known `brief` article now returns 200 with `index, follow`, confirming the May 7 `f19a8530` fix is live.
- Legacy URL variants such as `www` and locale-less `/articles/<slug>` hard-redirect to canonical apex locale URLs.

Root cause is therefore a mix of historical site behavior plus crawler lag, not a single current Cloudflare cache failure:

1. Before `f19a8530`, `brief` articles emitted `noindex`, which explains the large Search Console `Excluded by noindex` bucket.
2. Old URL variants (`www`, locale-less `/articles`, wrong section paths) created redirect and canonical fragmentation. Current production redirects them, but GSC will continue reporting those old URLs until recrawl.
3. The article pipeline still creates many lower-authority or thin pages, which explains `Crawled - currently not indexed` even when technical indexability is now correct.
4. Recent May content is present in the sitemap, but the GSC performance export still mostly shows older April URLs, so discovery/ranking is lagging behind publishing.

## Evidence

Search Console export: `C:\Users\jmskh\Downloads\zcybernews.com-Performance-on-Search-2026-05-14.zip`

- `Chart.csv`: 7 rows, 2026-05-06 to 2026-05-12, 0 clicks, 41 impressions.
- `Queries.csv`: 0 rows, so the export cannot identify dropped queries.
- `Pages.csv`: 38 rows, still dominated by April URLs and stale host/path variants.
- Suspicious patterns: `www` vs apex, locale-less `/articles`, mixed `/articles` and `/threat-intel`, and no May article URLs in performance rows.

Production smoke, 2026-05-14:

- Known GSC article: `https://zcybernews.com/en/articles/2026-04-14-cisa-warns-exploited-windows-adobe-acrobat-vulnerabilities` has canonical and no `noindex`.
- Known `brief` article: `https://zcybernews.com/en/threat-intel/2026-04-12-ai-powered-threat-actor-breaches-mexican-government` has no `noindex`.
- Legacy article URL: `https://zcybernews.com/articles/2026-04-14-cisa-warns-exploited-windows-adobe-acrobat-vulnerabilities` returns 308 to `/en/articles/...`.
- Legacy `www` category URL returns 308 to apex.
- Sitemap body contains `2026-05-14-`.

Local audits, 2026-05-14:

- `npm run seo:audit:all`: 216 articles scanned in the 7-day window; 216 indexable; 0 noindex/undiscoverable; 0 critical blocked.
- `seo-surfaces`: 1,305 sitemap URLs, 1,093 public article URLs, 481 non-public article URLs excluded from high-signal surfaces.
- Targeted Vitest suite: 4 files passed, 42 tests passed.

## Tracker

| ID         | Lane                                  |             Owner | Priority | Status     | Acceptance Criteria                                                                                                                        |
| ---------- | ------------------------------------- | ----------------: | -------: | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| SEO-REG-01 | GSC baseline from May 14 export       |       Maya + Noah |       P0 | Done       | Current export summarized with date range, page patterns, and limits called out.                                                           |
| SEO-REG-02 | Production indexability smoke         |    Raymond + Maya |       P0 | Done       | Smoke test checks known GSC article canonical, no current noindex, brief article not noindex, legacy redirects, and fresh sitemap entries. |
| SEO-REG-03 | Cloudflare/cache diagnosis            | Vincent + Raymond |       P0 | Done       | Current headers show Cloudflare in front, but sampled pages are fresh/correct; no active stale noindex evidence.                           |
| SEO-REG-04 | URL canonical fragmentation           | Vincent + Raymond |       P0 | Monitoring | `www`, locale-less, and wrong-section URLs redirect now; keep watching GSC decay rather than changing canonical target again.              |
| SEO-REG-05 | Noindex regression guard              |           Raymond |       P0 | Done       | `scripts/smoke-test-prod.sh` fails if known article or brief URL emits `noindex`.                                                          |
| SEO-REG-06 | Content quality / crawled-not-indexed |       Alex + Maya |       P1 | Open       | Quantify thin/single-source articles and raise the pipeline gate where quality, not technical indexability, is the blocker.                |
| SEO-REG-07 | Stored tier cleanup                   |           Raymond |       P1 | Open       | 4 recent ZH articles have gate-public/stored-brief mismatch; backfill or let pipeline update tiers.                                        |
| SEO-REG-08 | GSC validation follow-up              |              Noah |       P1 | Open       | After deployment, request validation for `Excluded by noindex`, `Soft 404`, and `Page with redirect`; record dates and outcomes.           |

## Recommendation

Ship the smoke-test guardrail now. Do not rollback recent content commits based on the current export. The next high-leverage fix is content quality and crawl-priority: fewer thin/duplicate article pages, stronger source synthesis, and more internal linking from section/tag pages to the highest-value articles.
