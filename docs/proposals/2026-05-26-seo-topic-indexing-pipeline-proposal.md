# SEO Topic Indexing Pipeline Proposal

Status: Draft for founder review
Owner: Alex, Maya, Noah, SEO Specialist
Last reviewed: 2026-05-26
Review window: 3, 7, and 14 days after approval
Decision needed: approve the reduced-volume, human-gated editorial pipeline before implementation.

Related repo docs:

- [SEO product reset status](../seo-product-reset-status-2026-05-17.md)
- [SEO full audit](../seo-full-audit-2026-05-05.md)
- [SEO indexability root cause](../seo-indexability-root-cause-2026-05-14.md)
- [SEO product pipeline reset design](../superpowers/specs/2026-05-17-seo-product-pipeline-reset-design.md)
- [SEO product pipeline reset plan](../superpowers/plans/2026-05-17-seo-product-pipeline-reset.md)
- [Pipeline contracts](../pipeline-contracts-2026-04-22.md)

## Answer First

The proposed shift is the right direction. ZCyberNews should stop treating the pipeline as an hourly article factory and instead operate it as a search-first editorial selection system: collect cyber events across CVEs, ransomware, malware, APT, AI security, data breaches, policy, and defender operations; curate 1 to 5 candidates per batch; require human review with a written selection reason; then publish only the strongest approved pieces.

The Google issue should be treated as two separate problems:

1. Technical eligibility: Googlebot must be able to crawl a stable canonical URL, see indexable content, see useful metadata, and discover the page through internal links and sitemaps.
2. Indexing choice: even when the technical layer is correct, Google may still not index thin, duplicate, low-value, overproduced, weakly sourced, or poorly linked pages.

That explains the "Google worked before but not now" concern: a previous technical fix can make pages eligible again, but it does not force indexing. If the pipeline keeps publishing too much low-differentiation AI content, Google can still choose not to index new pages. The next move is lower volume, stronger selection, stronger sourcing, and Search Console feedback.

## Recommended Operating Model

Run the pipeline 3 times per day with an 8-hour gap:

- 08:00 Asia/Shanghai
- 16:00 Asia/Shanghai
- 00:00 Asia/Shanghai

GitHub Actions cron is UTC, so the equivalent schedule is:

```yaml
cron: "0 0,8,16 * * *"
```

Each scheduled run should produce a review queue, not immediate public articles. The queue should contain 1 to 5 candidate packages. It is acceptable to publish zero articles from a run if the candidates are weak.

During the first 3 to 14 days, humans should review candidates daily or twice daily. Each review should mark every candidate as:

- `approved`: publish or generate a publish-ready draft.
- `hold`: keep for follow-up if more evidence appears.
- `digest-only`: use in a roundup or internal note, not a standalone article.
- `reject`: do not publish.

Every selected article must include a reason. These reasons become the training signal for tuning the selector.

This manual review period is capped at 14 days. It exists to tune the AI pipeline to founder/editor taste so the pipeline generates articles the operator likes and believes readers will like. After Day 14, scheduled publishing should run autonomously again unless quality degradation triggers a return to review mode.

## Google Search Central Synthesis

| Google guidance                                                                                                                                        | ZCyberNews implication                                                                                                                       | Proposal decision                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Search Essentials require pages that are technically crawlable, indexable, and non-spam.                                                               | Technical health is necessary but not enough. We need live status, canonical, robots, sitemap, and page-render checks before blaming Google. | Add a pre-publish technical SEO gate and a 10-URL smoke check before enabling new automation.                  |
| Helpful content should be people-first, original, complete, clearly sourced, and useful beyond aggregation.                                            | Rewritten RSS items and generic AI summaries are weak candidates, especially in crowded CVE news.                                            | Add an editorial value gate before generation and publication.                                                 |
| Google says there is no preferred word count.                                                                                                          | Word count floors help avoid thin content, but length alone is not a ranking strategy.                                                       | Keep category-specific minimums as quality safeguards, but require evidence depth and user utility.            |
| Generative AI is acceptable when quality, accuracy, relevance, and usefulness are handled well. It is risky when used to mass-produce low-value pages. | The pipeline can use AI, but not as an unchecked publisher. AI output must be reviewed, attributed, and grounded in sources.                 | Use AI for clustering, SEO extraction, drafting, and synthesis; require human approval during recovery.        |
| URLs should be stable, readable, lowercase, hyphenated, and canonicalized.                                                                             | URL churn during recovery can make indexing harder.                                                                                          | Do not migrate public article URLs in the first pass. Improve future URL contracts first.                      |
| Sitemaps help discovery but do not guarantee indexing. News sitemaps should only include recent news articles.                                         | The normal sitemap and news sitemap should have different eligibility rules.                                                                 | Keep `/sitemap.xml` for canonical public pages and add a separate news sitemap only for recent, approved news. |
| Titles should be descriptive, concise, distinct, and non-clickbait.                                                                                    | CVE-heavy titles can become repetitive and low-CTR.                                                                                          | Generate title candidates from search intent, affected product, actor, impact, and concrete user value.        |
| Meta descriptions should be unique, page-specific, and human-readable.                                                                                 | Boilerplate descriptions hurt search-result usefulness.                                                                                      | Generate a metadata brief per candidate and block generic descriptions.                                        |
| Article structured data needs accurate headline, author, images, and dates. Dates must be visible and consistent.                                      | Article JSON-LD and byline dates must match the actual publication/update state.                                                             | Add a structured-data validation checklist to the publish gate.                                                |
| Hreflang requires reciprocal localized versions.                                                                                                       | EN/ZH publication needs strict alternate URL consistency.                                                                                    | During recovery, prefer English-first publishing unless translation quality and reciprocal links are ready.    |
| Internal links should be crawlable `<a href>` links with descriptive anchors.                                                                          | New articles need discoverable paths from hubs, category pages, tags, and related articles.                                                  | Build topic hubs and internal-link targets into the SEO brief.                                                 |
| Discover favors high-quality, timely, non-clickbait stories with strong representative images.                                                         | Discover is a bonus channel, not a guaranteed acquisition path.                                                                              | Add image quality and `max-image-preview:large` checks for high-priority news.                                 |
| Search Console should monitor indexing, sitemaps, pages, queries, devices, countries, and traffic drops.                                               | Pipeline tuning needs GSC evidence, not vibes.                                                                                               | Import or manually attach GSC snapshots to the review cycle.                                                   |

## Current ZCyberNews Fit

What is already strong:

- The site already has centralized publication logic in `lib/publication.ts`.
- The sitemap already filters public article surfaces instead of blindly listing all content.
- Article pages already emit canonical metadata, Open Graph data, robots metadata, and JSON-LD.
- The pipeline already has a directionally correct architecture: source ingest, clustering, editorial selection, SEO brief, article generation, quality gate, fact check, MDX write, and decision matrix.
- Recent pipeline work already moves selection toward evidence packets, topic lanes, source trust, and portfolio balance.

Current gaps:

- The GitHub Actions workflow still runs hourly, which is too aggressive for recovery.
- The automated pipeline can still write public MDX directly instead of producing a human review queue first.
- There is no durable approve/reject/hold/digest-only queue with reviewer reasons.
- Manual admin publishing does not share the same selector, decision matrix, and SEO gates as the automated pipeline.
- `seo_query_target`, `seo_intent`, and `target_hub` are written by the pipeline but are not fully modeled as first-class public content fields.
- There is no separate Google News sitemap path with strict 48-hour eligibility.
- Topic hubs and internal-link targets exist conceptually but are not yet the controlling discovery layer.
- Search Console data is not yet feeding the selector or rewrite queue.

## Topic Coverage Model

The pipeline should not be CVE-only. It should classify and score candidates across these lanes:

| Lane                   | Examples                                                                   | Publish when                                                                                           |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Active CVEs            | exploited vulnerabilities, emergency patches, CISA KEV, vendor advisories  | There is credible exploitation, widespread exposure, high operational risk, or clear mitigation value. |
| Ransomware             | victim claims, leak-site activity, confirmed incidents, ransomware tooling | There are credible sources, named affected organizations, or defensive lessons.                        |
| Malware                | loaders, infostealers, botnets, mobile malware, phishing kits              | There are useful IOCs, TTPs, campaign context, or prevention guidance.                                 |
| APT and state activity | named clusters, geopolitical targeting, campaign reports                   | There is attribution confidence, sector relevance, or notable new tradecraft.                          |
| AI security            | AI abuse, model security, agent threats, data leakage, AI policy           | There is concrete cyber relevance, not generic AI hype.                                                |
| Data breaches          | confirmed disclosures, regulatory notices, exposed databases               | There is source depth, affected user/company clarity, and practical impact.                            |
| Defender operations    | detection engineering, tools, cloud controls, incident response            | There is actionable defensive value.                                                                   |
| Policy and ecosystem   | regulation, enforcement, vendor shifts, cyber insurance                    | There is strategic relevance to security teams or business owners.                                     |

Portfolio balance should be part of the selector. If recent output is overloaded with CVEs, a medium-urgency ransomware or malware story can outrank another low-differentiation CVE summary.

## Candidate Package Contract

Each scheduled run should write candidate packages to a review queue before any article is public. Proposed location:

```text
data/editorial-queue/YYYY-MM-DD/run-HHMM/
```

Each candidate package should include:

- Candidate ID and cluster key.
- Topic lane and category.
- Proposed title and slug.
- Primary query target.
- Secondary search phrases and entities.
- Source URLs and source trust notes.
- Evidence packet summary.
- Selection score and component scores.
- Selection reason in plain English.
- Rejection risks and missing evidence.
- Recommended action: approve, hold, digest-only, or reject.
- SEO brief: search intent, title promise, meta promise, internal link targets, target hub, canonical path, image brief, and sitemap eligibility.
- Structured data checklist.
- News sitemap eligibility.
- Reviewer fields: reviewer, decision, decision reason, reviewed at, `0.01` to `1.0` taste rating, why/why-not taste signals, selected reason tags, site-fit notes, reader-fit notes, and operator notes.

## Selection Reason Taxonomy

The reviewer should tag one or more reasons for approval:

- `urgent-risk`: active exploitation, ransomware incident, major breach, or emergency patch.
- `search-demand`: likely audience demand based on Search Console, Trends, recent queries, or source velocity.
- `original-value`: ZCyberNews can add synthesis, defensive actions, timeline clarity, or cross-source analysis.
- `source-strength`: primary or high-trust sources confirm the story.
- `portfolio-balance`: fills a non-CVE lane that has been under-published.
- `evergreen-value`: useful beyond the current news cycle.
- `follow-up`: builds on a previous ZCyberNews article or hub.

Rejection reasons should be equally structured:

- `thin-source`: too few credible sources.
- `duplicate-topic`: already covered recently.
- `generic-rewrite`: no added value beyond source summaries.
- `unsupported-claim`: attribution, impact, or exploit claim is not backed by evidence.
- `low-cyber-relevance`: interesting news but weak cybersecurity angle.
- `seo-weak`: unclear query intent, weak title, or no useful internal-link target.
- `hold-for-confirmation`: likely important, but facts are still unstable.

## Article Generation Requirements

Approved articles should be generated from the candidate package, not directly from raw feed text. The article prompt and schema should produce:

- Search intent and primary query.
- Clear title and H1 candidate.
- Unique meta description.
- Canonical slug and canonical URL proposal.
- Article category, tags, and topic hub.
- Evidence-backed summary.
- Timeline or "what changed" section when relevant.
- "Who is affected" and "what defenders should do" sections when relevant.
- Source citations with conservative attribution.
- Structured fields for CVEs, malware, threat actors, sectors, regions, IOCs, and TTPs.
- Image prompt or image selection brief with alt text.
- Internal-link targets and anchor text.
- Date published and date modified policy.
- News sitemap eligibility.
- Reviewer and selection-reason metadata.

The prompt should explicitly block:

- Unsupported attribution.
- Overstated exploitation claims.
- Rephrased source material without added analysis.
- Keyword stuffing.
- Clickbait titles.
- Artificial freshness updates.
- Generic "what you need to know" filler.

## URL And Directory Guidance

First recovery principle: avoid URL churn unless there is a proven technical blocker. Existing public article URL patterns should remain stable during the first implementation stage.

Recommended structure:

```text
data/editorial-queue/YYYY-MM-DD/run-HHMM/*.json
content/en/posts/*.mdx
content/zh/posts/*.mdx
public/sitemaps/news.xml
app/[locale]/topics/[hub]/page.tsx
```

Recommended public URL patterns:

- Keep existing article URL patterns unless a separate migration plan is approved.
- New topic hubs should use stable, lowercase, hyphenated paths such as `/en/topics/ransomware/`.
- Tags should remain public only when they have enough quality content and non-thin intro copy.
- Candidate drafts and review artifacts must not be routable, linked in public navigation, or included in sitemaps.

Sitemap rules:

- Normal sitemap: canonical public pages only.
- News sitemap: approved news articles only, published in the last 48 hours, with required news metadata.
- Exclude drafts, private pages, admin pages, queue artifacts, low-quality tag pages, and non-canonical alternates.
- Use `lastmod` only when the page has a real significant update.

## Manual Review Cadence

Days 0 to 1:

- Review a large candidate set and approve only a few examples the founder genuinely likes.
- Rate every reviewed candidate from `0.01` to `1.0`.
- Add why/why-not signals, not just a number: for example `hot-topic`, `historical-exploitation`, `active-exploitation`, `reader-likely-cares`, `defender-actionable`, `generic-rewrite`, or `low-reader-value`.
- Treat `0.8` and above as liked/publishable for calibration.
- Capture negative examples too; low ratings are the fastest way to teach the selector what to avoid.

Day 3:

- Review one dry-run queue daily.
- Confirm no unexpected `noindex`, canonical, robots, or sitemap regression.
- Inspect selected clusters and rejected clusters.
- Check that CVE, ransomware, malware, APT, AI security, and breach lanes are all being considered.
- Approve only the strongest candidates.
- Apply the first taste-profile adjustment so more candidates match founder preference.

Day 7:

- Review the decision matrix and selection reasons.
- Generate and publish a small number of approved articles.
- Track which rejected articles later became important.
- Tune source trust and topic weights.
- Target: 70-80% of selected candidates are rated `>=0.8`.

Day 10:

- Review whether the selector is repeating weak patterns.
- Suppress low-rated lanes, sources, source mixes, and reason tags.
- Target: 80-90% of selected candidates are rated `>=0.8`.

Day 14:

- Add Search Console exports to the review packet.
- Compare indexed vs not-indexed articles by topic lane, source count, title type, internal links, and article depth.
- Start a rewrite queue for pages with impressions but low CTR.
- Decide whether to increase, keep, or further reduce volume.
- Target: at least 90% of selected candidates are rated `>=0.8`.
- Routine manual review ends. If quality, SEO, attribution, and GSC gates are clean, return to normal autonomous publishing. If the 90% target is missed, run autonomously with stricter caps/gates and daily sample audit rather than extending full manual review indefinitely.
- If quality later degrades, return to review mode automatically.

Suggested meeting rhythm:

- Daily 20-minute review during days 1 to 3.
- Twice-daily review if the queue quality is high or there are major incidents.
- Day 7 and day 14 go/no-go check led by Eric or Alex.

## Full-Team Recommendation

| Owner                    | Recommendation                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alex, Product            | Approve reduced-volume recovery mode. Treat the pipeline as a selection product, not an article generator.                                                                            |
| Maya, Marketing          | Make query-first packaging mandatory. Every article needs a target audience, search intent, and result-page promise.                                                                  |
| SEO Specialist           | Implement the Search Central checklist before publish: canonical, title, meta, structured data, visible dates, hreflang, internal links, sitemap eligibility, and news sitemap rules. |
| Noah, Knowledge          | Keep this as an operating memo with a decision log and daily review packet, not just an engineering task list.                                                                        |
| Vincent, Architecture    | Do not change public URLs or sitemap contracts without a migration plan. Build queue and metadata contracts first.                                                                    |
| Raymond, Engineering     | Implement the selector, review queue, SEO brief extensions, tests, and dry-run validation in stages.                                                                                  |
| Ken, Design              | Make topic hubs and admin review screens useful for scanning, comparison, and repeated editorial decisions.                                                                           |
| Sam, Process             | Keep 3, 7, and 14 day review gates. Require evidence for every tuning change.                                                                                                         |
| Content Creator          | Draft only from approved candidate packages and source evidence.                                                                                                                      |
| AI Citation Strategist   | Later phase: tune for AI search/citation surfaces after core Google indexing stabilizes.                                                                                              |
| Agentic Search Optimizer | Later phase: agent-readable summaries and entity consistency after core editorial quality is stable.                                                                                  |

## Staged Implementation

Stage 0: Approval and baseline

- Approve this proposal or edit the decision points below.
- Capture fresh Search Console exports: pages, indexing, sitemap, queries, CTR, and Discover if available.
- Run a live 10-URL technical smoke: status, robots, canonical, rendered noindex, sitemap presence, JSON-LD, hreflang, and internal links.

Stage 1: Reduced schedule and curate-only mode

- Change the workflow schedule from hourly to 3 times daily.
- Add `--curate-only` or equivalent mode.
- Generate review queue artifacts instead of public MDX.
- Keep Telegram/admin output focused on selected and rejected candidates.

Stage 2: Manual review queue

- Add admin queue UI or a simple reviewed JSON workflow.
- Support approve, hold, digest-only, and reject.
- Require reviewer reason.
- Persist decisions for tuning.
- Use `npx tsx scripts/pipeline/review-candidate.ts --file=... --status=approved --reviewer=alex --rating=0.92 --reason="..." --positive=hot-topic,reader-likely-cares --tags=...` as the repo-native workflow until the admin screen exists.
- Current repo status: `/admin/review` now provides the admin queue UI over the same JSON contract. It lists queue runs and candidates, records status, taste rating, reviewer, decision reason, positive/negative signals, reason tags, calibration round, and notes, then rebuilds the taste profile through `app/api/admin/review-queue`.

Stage 3: Approved generation and publish gate

- Generate article drafts only from approved candidate packages.
- Add `draft: true` or private queue state until final approval.
- Publish only after quality, fact-check, SEO, and public gate pass.
- Use `npx tsx scripts/pipeline/index.ts --approved-queue=data/editorial-queue/YYYY-MM-DD/run-HHMMZ` to publish from a reviewed run. Pending, held, digest-only, rejected, or incompletely reviewed candidates stay out of generation.
- Preserve approval metadata in article frontmatter with `editorial_*` fields so later Search Console analysis can connect published pages back to selection taste and reviewer decisions.

Stage 4: Taste calibration and autonomy gate

- Add `0.01` to `1.0` taste ratings to review queue records.
- Add structured preference signals and notes so the selector learns why an article fits or misses the site's editorial taste.
- Aggregate reviewed candidate ratings into a taste profile.
- Build the profile with `npx tsx scripts/pipeline/build-taste-profile.ts --queue-root=data/editorial-queue --output=data/editorial-taste-profile.json`.
- Load `data/editorial-taste-profile.json` during selection so reviewed lanes, sources, reason tags, and taste signals can nudge future candidate scoring.
- Tune selector weights at Day 3, Day 7, Day 10, and Day 14.
- Use `tasteRating >= 0.8` as the liked/publishable threshold.
- Day 7 target: 70-80% liked candidates.
- Day 10 target: 80-90% liked candidates.
- Day 14 target: at least 90% liked candidates.
- After Day 14, end routine manual review and allow autonomous publishing. If the 90% target is missed, use stricter caps/gates and sample audit instead of extending full manual review.
- Re-enable review if rolling quality drops below the target.
- Current repo status: `scripts/pipeline/autonomy-gate.ts` now enforces this operating model for scheduled runs. It keeps curation on during the 14-day window, uses normal autonomous mode only when the Day 14 taste target and Alex/Eric approval are clean, uses strict autonomous mode when targets are missed, and reopens review for rolling-quality, GSC, rejection, or incident degradation signals.

Stage 5: SEO metadata extraction

- Extend article/frontmatter schemas for SEO fields already being produced.
- Add canonical path, primary query, search intent, title promise, meta promise, target hub, selection reason, reviewer, image alt, news sitemap eligibility, and internal-link targets.
- Add parser/schema tests for these fields.
- Current repo status: generation now requires and persists `seo_query_target`, `seo_intent`, `seo_title_promise`, `seo_meta_promise`, `target_hub`, `internal_link_targets`, `featured_image_alt`, and `news_sitemap_eligible`. Approved-publishing metadata is stored separately under `editorial_*` fields.

Stage 6: Topic hubs, sitemap split, and internal links

- Add topic hubs for ransomware, malware, APT, AI security, active CVEs, breaches, defender operations, and policy.
- Add internal-link recommendations to article generation.
- Add a news sitemap with strict eligibility.
- Keep existing URLs stable unless a separate migration plan is approved.
- Current repo status: `/sitemaps/news.xml` is implemented as a separate Google News sitemap. It only includes explicitly news-eligible public/indexable articles from the last 48 hours and is advertised from `robots.txt` beside the normal sitemap.
- Current repo status: topic hubs now exist at `/[locale]/topics/[hub]` for ransomware, malware, APT groups, AI security, active CVEs, breaches, defender operations, and cyber policy. Hubs are sitemap-eligible only after at least five public matching articles, and article pages render crawlable hub links from SEO frontmatter.

Stage 7: GSC feedback loop

- Import or manually attach GSC exports weekly during recovery.
- Track impressions, clicks, CTR, indexing status, discovered-not-indexed, crawled-not-indexed, rich-result errors, and sitemap errors.
- Feed indexed/non-indexed outcomes back into topic weights and title/meta rewrites.
- Current repo status: `npm run seo:gsc:import -- --input=<csv>` can convert manual Search Console query/page exports into `data/gsc-demand-hints.json`. The search-demand scorer automatically prefers that file when present, so real GSC demand can tune candidate scoring without requiring API credentials.

## Decision Log

| ID  | Date       | Owner          | Decision                                                                                          | Why                                                                         | Alternatives                                 | Review date | Links                         |
| --- | ---------- | -------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- | ----------- | ----------------------------- |
| D1  | 2026-05-26 | Alex           | Reduce scheduled publishing to 3 batches per day.                                                 | Hourly publishing is too noisy for recovery.                                | Keep hourly with stricter max articles.      | Day 7       | This proposal                 |
| D2  | 2026-05-26 | Maya           | Queue candidates before publishing.                                                               | Selection quality and reasoning need human feedback.                        | Continue auto-publish with post-hoc audit.   | Day 3       | This proposal                 |
| D3  | 2026-05-26 | SEO Specialist | Require pre-publish SEO gate.                                                                     | Google Search eligibility depends on technical and content quality signals. | Audit only after publish.                    | Day 7       | Google Search Central sources |
| D4  | 2026-05-26 | Vincent        | Freeze public URL migrations during stage 1.                                                      | URL churn can make recovery harder.                                         | Redesign URL structure immediately.          | Day 14      | Pipeline contracts            |
| D5  | 2026-05-26 | Raymond        | Add queue metadata before admin polish.                                                           | The pipeline contract must exist before UI depends on it.                   | Build admin UI first.                        | Day 7       | This proposal                 |
| D6  | 2026-05-26 | Noah           | Use 3, 7, and 14 day review gates.                                                                | Search Console validation and indexing outcomes need time.                  | Make changes daily without evidence windows. | Day 14      | SEO reset status              |
| D7  | 2026-05-26 | Eric           | Treat Cloudflare or hosting as not the active root cause unless fresh smoke tests show a blocker. | Avoid chasing infrastructure without evidence.                              | Assume provider issue.                       | Day 3       | SEO indexability root cause   |

## Success Metrics

3-day target:

- Pipeline runs 3 times daily in curate-only mode.
- Every run produces a review queue with selected and rejected candidates.
- No public draft or queue artifact appears in sitemap.
- At least one non-CVE lane appears in every daily candidate review unless the news cycle is unusually narrow.

7-day target:

- Approved articles include selection reasons and SEO briefs.
- Manual reviewers can explain why each article was published or rejected.
- GSC exports are attached to the status tracker.
- No canonical, hreflang, sitemap, robots, or route churn occurs without approval.

14-day target:

- Indexed vs non-indexed outcomes are compared by lane, article type, title pattern, source depth, internal links, and sitemap type.
- Selector weights are tuned from reviewer decisions and early GSC outcomes.
- Topic hub/internal-link gaps are prioritized.
- At least 90% of selected candidates are rated `>=0.8`.
- Eric/Alex decide whether to continue, narrow, or allow autonomous publishing.

30-day target:

- Publishing volume is stable and intentional.
- Non-CVE lanes have consistent representation.
- Pages with impressions but poor CTR have a rewrite queue.
- The pipeline can publish automatically only when the candidate and SEO gates pass.

## Next Review Packet

| Packet item           | Owner          | Required contents                                                                            |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| Date and run IDs      | Noah           | Current date, run times, queue artifact paths, and dry-run status.                           |
| Three URLs to inspect | SEO Specialist | One recent article, one topic/category page, one sitemap-listed URL.                         |
| Three candidate rows  | Alex           | One approved, one rejected, one held candidate with reasons.                                 |
| GSC export status     | Maya           | Latest indexing, pages, queries, CTR, sitemap, and Discover export status.                   |
| Smoke result          | Raymond        | Status, robots, canonical, noindex, JSON-LD, hreflang, sitemap, and internal-link pass/fail. |
| Decision required     | Eric           | Continue, tune, pause, or expand.                                                            |

## Source Coverage

Official Google Search Central and Google support docs reviewed for this proposal:

- [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Search Essentials](https://developers.google.com/search/docs/essentials)
- [Technical requirements](https://developers.google.com/search/docs/essentials/technical)
- [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Guidance on using generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure)
- [Sitemaps overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [News sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap)
- [Title links](https://developers.google.com/search/docs/appearance/title-link)
- [Snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Breadcrumb structured data](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
- [Byline dates](https://developers.google.com/search/docs/appearance/publication-dates)
- [Localized versions and hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Google Discover](https://developers.google.com/search/docs/appearance/google-discover)
- [Search Console start](https://developers.google.com/search/docs/monitor-debug/search-console-start)
- [Search Console and Analytics data](https://developers.google.com/search/docs/monitor-debug/google-analytics-search-console)
- [Debugging Search traffic drops](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops)
- [Search Console indexing report validation](https://support.google.com/webmasters/answer/7440203)
