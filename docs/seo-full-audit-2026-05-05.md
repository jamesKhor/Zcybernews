# ZCyberNews SEO + GSC Audit — 2026-05-05

Owner: Alex program lane, Maya Engineering, SEO Specialist, Pipeline Agent, Marketing/Editorial, Data Agent

## Executive Summary

Google is not ignoring ZCyberNews. The May 5 GSC export shows 303 pages with impressions and 26 clicks from 3,038 page impressions, but the blended page CTR is only 0.86%. The April 21 coverage export shows a larger indexation problem: 552 pages discovered but not indexed and 128 crawled but not indexed. The primary gap is therefore mixed: Google can discover and rank parts of the site, but too many pages are thin, duplicated by URL variants, or weakly packaged for clicks.

The immediate goal is not "longer for Google's word count." Google explicitly says it does not have a preferred word count. The goal is to publish pages complete enough to satisfy a defender's query: clear title, useful meta description, canonical URL, sources, technical detail, affected entities, and internal links.

## Inputs

- GSC Performance export: `C:\Users\jmskh\Downloads\zcybernews.com-Performance-on-Search-2026-05-05`
- GSC Coverage export: `C:\Users\jmskh\Downloads\zcybernews.com-Coverage-2026-04-21.xlsx`
- GSC Coverage drilldowns: `C:\Users\jmskh\Downloads\zcybernews.com-Coverage-Drilldown-2026-04-19*.zip`
- Live checks: `https://zcybernews.com/robots.txt`, `https://zcybernews.com/sitemap.xml`, sample article pages
- Google Search docs: helpful content, title links, snippets/meta descriptions, canonicalization, noindex, Page Indexing report

## GSC Findings

Performance, May 5 export:

- Pages: 303 rows, 26 clicks, 3,038 impressions, 0.86% CTR.
- Queries: 102 rows, 5 clicks, 356 impressions, 1.40% CTR.
- Host split: apex `zcybernews.com` has 2,420 impressions; `www.zcybernews.com` still has 618 impressions.
- Duplicate URL variants are visible in GSC, especially `www` vs apex and non-locale vs locale redirects.

Coverage, April 21 export:

- Indexed: 376 pages.
- Not indexed: 872 pages.
- Page with redirect: 154.
- Alternate page with proper canonical tag: 27.
- Soft 404: 1.
- Excluded by noindex: 1.
- Discovered - currently not indexed: 552.
- Crawled - currently not indexed: 128.
- Server error: 7.
- Not found: 2.

Top zero-click page opportunities from May 5:

- `https://zcybernews.com/en/threat-intel/2026-04-14-mcgraw-hill-data-breach-salesforce-misconfiguration`: 350 impressions, 0 clicks, position 8.05.
- `https://www.zcybernews.com/en/articles/2026-04-13-obsidian-plugin-abused-phantompulse-rat-targeted-campaign`: 159 impressions, 0 clicks, position 6.6.
- `https://zcybernews.com/en/articles/2026-04-14-microsoft-patches-zero-days-windows-10-extended-security-update`: 146 impressions, 0 clicks, position 5.74.
- `https://www.zcybernews.com/en/articles/2026-04-15-capsule-security-emerges-from-stealth-with-platform-to-constrain-ai-agent-action`: 117 impressions, 0 clicks, position 7.2.
- `https://zcybernews.com/threat-intel/2026-04-14-mcgraw-hill-data-breach-salesforce-misconfiguration`: 96 impressions, 0 clicks, position 9.77.

Top zero-click query opportunities:

- `orthanc dicom rce`: 27 impressions, position 9.11.
- `kb5083769`: 23 impressions, position 1.0.
- `capsule security series a april 2026`: 17 impressions, position 5.47.
- `kb5082200`: 17 impressions, position 11.76.
- `microsoft adds windows protections for malicious remote desktop files`: 13 impressions, position 10.15.
- `intext:"cve-2024-38112"`: 9 impressions, position 4.11.
- `mcgraw hill data breach april 2026`: 8 impressions, position 10.75.

## Technical SEO Findings

Robots and sitemap:

- `robots.txt` returns 200 and allows public routes.
- `sitemap.xml` returns 200 and has 1,658 unique `<loc>` URLs in the live deployment.
- No duplicate sitemap `<loc>` entries were found in the live sitemap sample.

Canonical and URL consolidation:

- `www` redirects to apex with 308, but GSC still shows 618 impressions on `www` URLs. This is expected to decay, but it should be monitored.
- Non-locale URLs redirect to `/en/...`, but GSC still shows impressions on non-locale URLs.
- Wrong-section article URLs can render weak noindex surfaces instead of redirecting to the real article route. Example checked: ShinyHunters Vimeo is valid at `/en/articles/...`, while `/en/threat-intel/...` returns a noindex soft page. These should redirect when the slug exists in the other section.

Structured data:

- Sample valid article pages emit NewsArticle and BreadcrumbList JSON-LD.
- NewsArticle JSON-LD should be enhanced with `articleSection` and source/citation fields when available.

Indexation:

- The 552 discovered-not-indexed pages point to crawl-priority and content-quality issues.
- The 128 crawled-not-indexed pages point to pages Google saw but did not consider worth indexing yet. Thin tag pages, weak summaries, and duplicate/canonical variants are likely contributors.

## Content + Pipeline Findings

Corpus audit from local MDX:

- Total MDX files: 1,332.
- Under 450 words: 962.
- Under 650 words: 1,224.
- Excerpt over 160 chars: 551.
- Excerpt over 180 chars: 303.
- Missing `source_urls`: 14.
- Threat-intel articles lacking stronger structured fields: 188.
- `publish_tier: brief`: 1,282.
- `publish_tier: public`: 50.

This is the strongest SEO quality signal in the audit. ZCyberNews has many pages, but many look like short syndicated summaries. Google’s helpful-content guidance asks whether content provides original information, complete description, analysis beyond the obvious, clear sourcing, and substantial value versus other search results. Many current pages are too short or too generic to win against primary cyber news sources.

## Code Changes Made In This Pass

Pipeline generation targets were raised:

- Advisory: `650-900 words`.
- Medium: `1000-1400 words`.
- Long: `1400-2000 words`.
- Extended: `1800-2600 words`.

Publish quality was tightened:

- `word_count_below_floor` now blocks automated publication.
- Editorial floors are now:
  - Threat intel: 900 words.
  - Vulnerabilities: 800 words.
  - Malware: 800 words.
  - Industry: 650 words.
  - Tools: 650 words.
  - AI: 650 words.

Schema bounds were tightened:

- Title max: 70 chars.
- Excerpt max: 180 chars.

Prompt language was updated:

- It now states Google has no preferred word count.
- It asks the model to reject `too-thin` rather than writing a short index-quality article when source material cannot support the floor without padding.

## Priority Fix Queue

P0: Canonical and route cleanup

- Redirect wrong-section article slugs to their canonical section when a slug exists elsewhere.
- Keep `www` to apex and non-locale to `/en` redirects.
- Confirm GSC no longer accrues impressions on `www` and non-locale variants over time.

Acceptance:

- Wrong-section ShinyHunters-style URLs 308 to the canonical article URL.
- Sitemap includes only canonical, indexable URLs.
- No `noindex` URLs appear in sitemap.

P0: Server and not-found cleanup

- Use GSC drilldowns to resolve the 7 server errors and 2 not found examples.

Acceptance:

- Each sample URL returns 200, intentional 301/308, 404, or 410.
- Deployment health checks include sitemap, robots, homepage, and 3 representative article pages.

P1: CTR rewrites from GSC

- Rewrite titles and excerpts for the top zero-click pages and queries.
- Focus first on McGraw Hill, Microsoft KB pages, Orthanc DICOM, Capsule Security, PhantomPulse, BlueHammer/CVE-2024-38112.

Acceptance:

- Each rewrite maps to an actual GSC query.
- Title leads with the searched entity: CVE, KB, actor, vendor, product, victim.
- Excerpt is 140-160 chars when possible and includes one concrete number/entity.

P1: Public vs brief sitemap discipline

- Briefs can still be generated for Telegram/internal review.
- Only complete, useful public articles should enter sitemap and GSC priority.

Acceptance:

- New generated articles below floor do not auto-publish.
- Daily Telegram summary reports blocked reason and candidate expansion path.

P2: Topic hubs and internal links

- Build hubs for ShinyHunters, Microsoft vulnerabilities, Linux privilege escalation, ransomware groups, active CVEs, data breaches, phishing, malware loaders, and SaaS breaches.

Acceptance:

- Each hub is indexable, has 600+ words of unique editorial intro/context, links to current articles, and is linked from related articles.
- Every public article gets at least 3 relevant internal links where possible.

P2: GSC feedback loop

- Weekly report: clicks, impressions, CTR, average position, indexed/not indexed, rising queries, low CTR pages, pages needing expansion.
- Monthly review: improve/noindex/merge/delete thin pages.

## Team Assignment

Alex:

- Owns the master board, sequencing, and integration.
- Blocks overlapping edits from multiple chats.

Maya Engineering:

- Owns route redirects, sitemap, robots, canonical, JSON-LD, and production verification.

SEO Specialist:

- Owns GSC query/page diagnosis, title/meta rewrites, indexation triage, and validation requests.

Pipeline Agent:

- Owns prompts, quality gates, source scoring, public/brief tiering, and Telegram surfacing of blocked SEO reasons.

Marketing/Editorial:

- Owns topic hubs, evergreen explainers, high-intent query mapping, and human review of high-opportunity stories.

Data Agent:

- Owns GSC export parser, weekly dashboard, and before/after measurement.

QA/Deploy:

- Owns production status checks, redirect checks, sitemap validation, structured data spot checks, and regression tests.

## References

- Google Search Central: Helpful content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Search Central: Title links: https://developers.google.com/search/docs/appearance/title-link
- Google Search Central: Canonicalization: https://developers.google.com/search/docs/crawling-indexing/canonicalization
- Google Search Central: noindex: https://developers.google.com/search/docs/crawling-indexing/block-indexing
- Google Search Console Help: Page indexing report: https://support.google.com/webmasters/answer/7440203
