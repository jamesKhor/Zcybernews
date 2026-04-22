# Pipeline Contracts v3 — Unified Data / SEO / UX / Distribution Spec

**Owners:** Vincent (architecture) · Maya (SEO + distribution) · Ken (UI/UX)
**Status:** Accepted — supersedes v2 (2026-04-22)
**Scope:** Contract boundaries for the zcybernews content pipeline, from ingest to reader surface to engagement loop.

---

## §1 Purpose

v1 framed the data flow. v2 layered SEO semantics. **v3 adds two more lenses:** Ken's UI/UX surface contract and Maya's translation-direction + digest-locale routing. The pipeline is now viewed through **four lenses operating on one shared artifact (the Article)**:

1. **Data-flow** (Vincent) — stage boundaries, idempotency, failure modes
2. **SEO** (Maya v1) — canonicalization, hreflang, sitemap, intent
3. **UX** (Ken) — client render contract, CWV, a11y, component placement
4. **Distribution routing** (Maya v2.1) — translation direction, digest locale, audience separation

All four lenses share one `PipelineContext` and one set of stage pairs. A change that satisfies one lens but breaks another is a regression — the compliance grid in §6 enforces this.

### Driver case that motivated v3

**FreeBuf (ZH-native source) approved for Q2 ingest** exposed two real gaps that v2 could not answer cleanly:

- Who decides translation direction when the source is already in the target language of another locale?
- How does the digest worker avoid sending ZH-only articles to EN subscribers (spam signal, sub churn, SEO harm via one-click-unsubscribe volume)?

The `§3.A` routing matrix and the `§3.1` digest behavior block were both written against this driver case. See sidebar in §3.A.

---

## §2 Module inventory (unchanged from v2 except one addition)

| Module                                                     | Role                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/pipeline/ingest-rss.ts`                           | Stage 1 — fetch, normalize, dedup                                                                                                                        |
| `scripts/pipeline/generate-article.ts`                     | Stage 2 — LLM prose                                                                                                                                      |
| `scripts/pipeline/post-process.ts`                         | Stage 3 — script-derived structured fields                                                                                                               |
| `scripts/pipeline/fact-check.ts`                           | Stage 4 — regex cross-validation                                                                                                                         |
| **`scripts/pipeline/translate-direction.ts`** **[NEW v3]** | **Single source of truth for EN↔ZH routing. Exports `TranslationDecision` + `getTranslationDirection(source, article)`. Every write site MUST call it.** |
| `scripts/pipeline/translate-article.ts`                    | Stage 4d — EN→ZH only (Cycle 1)                                                                                                                          |
| `scripts/pipeline/write-mdx.ts`                            | Stage 5 — serialize + commit                                                                                                                             |
| `scripts/pipeline/send-digest.ts`                          | Stage 7→8 — per-locale digest worker                                                                                                                     |
| `scripts/feedback/*.ts`                                    | Loops A-H feedback consumers                                                                                                                             |

---

## §3 Stage-pair contract table

Grouped by stage pair, then tag priority `[DATA]` → `[SEO]` → `[I18N]` → `[DISTRIBUTION]` → `[UX]`.

### Stage 1→2 (ingest → generate)

| Row                        | Producer                                      | Consumer contract                            | Validate      | Failure          |
| -------------------------- | --------------------------------------------- | -------------------------------------------- | ------------- | ---------------- |
| 1→2 source-identity [DATA] | `{url, sourceLanguage, publishedAt, rawText}` | sourceLanguage ∈ {en,zh}; rawText ≥400 chars | ingest schema | reject at ingest |
| 1→2 consensus-signal [SEO] | `{url, domain, title}` added to consensus map | dedup window 72h                             | unit test     | drop duplicate   |

### Stage 2→3 (generate → post-process)

| Row                   | Producer                                           | Consumer contract                   | Validate                     | Failure       |
| --------------------- | -------------------------------------------------- | ----------------------------------- | ---------------------------- | ------------- |
| 2→3 prose-body [DATA] | Article draft prose only; **no structured fields** | LLM does not emit slug/cve_ids/iocs | schema strips forbidden keys | reject loudly |

### Stage 3→4 (post-process → fact-check)

| Row                       | Producer                                                                          | Consumer contract                           | Validate                 | Failure        |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------ | -------------- |
| 3→4 derived-fields [DATA] | slug, cve_ids, iocs, cvss_score, threat_actor via regex                           | All derivations traceable to body + sources | smoke-test-extractors.ts | reject         |
| 3→4 cve-hard-gate [SEO]   | Strip `CVE-YYYY-XXXX` placeholders; category=vulnerabilities requires ≥1 real CVE | placeholder regex                           | CI lint                  | reject at gate |

### Stage 4→5 (fact-check → write) — and the new 4d

| Row                                                    | Producer                                                           | Consumer contract                                                                                                                                                                                           | Validate                                                    | Failure                 |
| ------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| 4→5 source-verification [DATA]                         | CVE / IOC / threat-actor cross-checked vs source URLs              | ≥80% of claims grounded                                                                                                                                                                                     | fact-check.ts                                               | reject                  |
| **4d→5 translation-direction [SEO+I18N+DISTRIBUTION]** | Article + sourceLanguage + seoIntent; **producer MUST NOT decide** | `getTranslationDirection(source, article)` is SSoT; ingest MUST evaluate matrix BEFORE write-mdx; soft-block `seoIntent=rank-both ∧ sourceLanguage=zh` with "ZH→EN translation not supported until Cycle 2" | unit test covering all 8 cells (2 sourceLang × 4 seoIntent) | reject loudly at ingest |

### Stage 5→6 (write → client render) — where UX lives

| Row                                 | Producer                                                                       | Consumer contract                         | Validate                      | Failure                       |
| ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------- | ----------------------------- |
| 5→6 frontmatter-schema [DATA]       | Zod-validated frontmatter                                                      | `ArticleFrontmatterSchema`                | write-boundary validation     | reject write                  |
| 5→6 canonical-url [SEO]             | `canonical = https://zcybernews.com/{locale}/{kind}/{slug}`                    | absolute + self-referencing               | head-tag probe                | CF cache poisoned → SEV3      |
| 5→6 hreflang-pair [SEO+I18N]        | `locale_pair` frontmatter wires alternates                                     | EN↔ZH round-trip; self + x-default        | generateMetadata unit         | reject                        |
| 5→6 sitemap-entry [SEO]             | Sitemap enumerates all live slugs                                              | `dynamic = force-dynamic + revalidate`    | smoke test                    | build timeout                 |
| **UX-01 title/excerpt length [UX]** | title ≤70, excerpt ≤160                                                        | write-boundary Zod refine                 | CI lint                       | reject                        |
| **UX-02 LCP image [UX]**            | featured_image ≥1200×630; `fetchpriority="high"`                               | ArticleCard + hero components             | Lighthouse CI                 | LCP budget miss               |
| **UX-03 CVE inline render [UX]**    | CVE array matches body regex post-gate                                         | CVEBadge renders inline; empty→no section | rehype-cve snapshot           | empty blocks or orphan badges |
| **UX-10 og/twitter card [UX]**      | og:image ≥1200×630 absolute; `twitter:card=summary_large_image`                | generateMetadata                          | opengraph.xyz sample (5 URLs) | social share breakage         |
| **UX-11 semantic outline [UX]**     | Exactly one `<h1>`; h2→h3 cascade; `<article>`/`<section>` landmarks           | HTML outline validator                    | CI                            | duplicate h1 = SEO regression |
| **UX-13 TagIntro [UX]**             | Render when `data/tag-intros/{locale}/{tag}.json` exists AND articles.length≥3 | TagIntro component guard                  | render test                   | thin-content surfacing        |

### Stage 6→client (client render contract)

| Row                                    | Producer                                                                         | Consumer contract          | Validate                 | Failure                                              |
| -------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------- |
| **UX-04 min-width root cause [UX]**    | `min-w-0` OR `overflow-hidden` on all flex/grid text containers                  | prevents mobile SEV1 class | Playwright overflow gate | horizontal scroll <320px                             |
| **UX-05 touch targets [UX]**           | ≥44×44 CSS px                                                                    | audit sample routes        | Playwright bbox          | a11y fail                                            |
| **UX-06 LCP budget [UX]**              | LCP image in initial HTML; Lighthouse CI LCP ≤2500ms mobile 4G                   | no lazy-load above fold    | Lighthouse CI            | budget fail → block merge                            |
| **UX-07 CLS [UX]**                     | Explicit width/height on img/iframe/ad slots; CLS ≤0.1                           | Lighthouse CI              | CI                       | CLS regression                                       |
| **UX-08 INP [UX]**                     | INP ≤200ms; bundle analyzer on SearchDialog + Header mobile menu                 | size-limit CI              | CI                       | INP regression                                       |
| **UX-09 CJK font [UX+I18N]**           | `/zh/**` preloads Noto Sans SC subset; `font-display: swap`                      | head-tag probe             | smoke                    | FOIT on CJK routes                                   |
| **UX-12 contrast [UX]**                | Body ≥4.5:1; chrome ≥3:1 (WCAG AA) both themes                                   | axe-core                   | CI                       | a11y fail                                            |
| **UX-14 one search surface [UX]**      | Exactly one SearchDialog entry per page — resolves B-005 (remove hero duplicate) | grep guard in CI           | CI                       | duplicate triggers, a11y/UX                          |
| **UX-15 CommunityCTA env-gated [UX]**  | Hide when DISCORD env unset                                                      | render test                | unit                     | dead link                                            |
| **UX-16 SubscribeForm coverage [UX]**  | Present on homepage, article, tag, threat-intel, salary                          | Playwright presence probe  | CI                       | funnel leak (feedback_check_placement_not_existence) |
| **UX-17 form lifecycle [UX]**          | loading/success/error within 200ms; disable button in-flight                     | unit                       | CI                       | double-submit                                        |
| **UX-18 branded error pages [UX]**     | 404/500 with Header+Footer, locale-aware copy                                    | synthetic probe            | uptime                   | bounce spike                                         |
| **UX-19 empty tag state [UX]**         | Tag pages with 0 articles show empty-state                                       | render test                | CI                       | thin content                                         |
| **UX-20 admin compose streaming [UX]** | Per-model step label + skeleton + done notification                              | admin integration test     | CI                       | operator uncertainty                                 |

### Stage 7→8 (published → engagement)

| Row                                                   | Producer                                                                                                                                                    | Consumer contract                                                                                                                  | Validate                                                                                                                                    | Failure                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **7→8 digest locale routing [SEO+DISTRIBUTION+I18N]** | Articles with locale ∈ {en,zh}, publish-state=live, **excludes `ingest-only`**, ordered by publishedAt DESC then qualityScore DESC then consensusScore DESC | Per-locale audience read: `RESEND_AUDIENCE_ID_EN` receives `locale=en` only; ZH receives `locale=zh` only. No cross-contamination. | Snapshot tests: EN payload zero `/zh/` URLs; ZH payload zero `/en/` URLs; neither contains `ingest-only`; subject language matches audience | Reject loudly — cross-locale = spam signal, sub churn, SEO harm |

---

## §3.A Translation routing matrix

Single source of truth. Implemented in `scripts/pipeline/translate-direction.ts`. Called at ingest, generate, write-mdx, and translate-publish.

| seoIntent \ source | EN source                            | ZH source                                   |
| ------------------ | ------------------------------------ | ------------------------------------------- |
| **rank-en**        | Publish EN only                      | **Soft-block at ingest**                    |
| **rank-zh**        | Translate EN→ZH; publish ZH only     | Publish ZH directly; skip translate         |
| **rank-both**      | Publish EN + translate EN→ZH         | **Soft-block at ingest** (Cycle 2 deferred) |
| **ingest-only**    | Consensus signal only; never publish | Consensus signal only; never publish        |

**Translation direction (Cycle 1):** EN→ZH only. ZH→EN is deferred (open question Q15).

### Sidebar — FreeBuf driver case

FreeBuf is ZH-native. Add it with `sourceLanguage=zh` + `seoIntent=ingest-only` → feeds consensus, never publishes. After a 30-day audit (Alex tracker), promote to `rank-zh` → publishes ZH directly, no translation round-trip. If the operator ever configures `rank-both` + `zh`, ingest soft-blocks with the Cycle 2 message. This single case is why the matrix exists as a module rather than an inline if/else in three places.

---

## §3.1 `send-digest.ts` required behavior

1. Read `RESEND_AUDIENCE_ID_EN` and `RESEND_AUDIENCE_ID_ZH` **separately**. Neither hardcoded.
2. Query articles **per locale**, not merged-then-filtered.
3. Exclude `ingest-only` articles.
4. Respect `seoIntent`: `rank-en` must never appear in ZH digest; `rank-zh` must never appear in EN.
5. Subject-line language matches the audience locale.
6. Emit a per-audience Resend tag so Loop H can split engagement stats by locale.
7. **Fail-closed** on a missing audience ID — skip that locale, do not merge into the other.

---

## §4 Feedback loops

**A.** Search Console clicks/impressions → Maya rewrites meta descriptions
**B.** Plausible engaged-session → Alex bubbles up high-engagement tags
**C.** Newsletter open/CTR (baseline) → Maya tunes subject templates
**D.** Discord reactions → operator curates share-worthy articles
**E.** XHS follower growth → Maya adjusts card-to-funnel messaging
**F.** Fact-check rejections → backlog triggers (e.g., B-001 hallucinated CVEs)

### §4.7 — Loop G: CWV → LCP-image backfill queue [UX]

- **Producer:** PageSpeed Insights API, weekly cron, 50 articles/week
- **Consumer:** fal.ai FLUX.1-schnell, 10 imgs/day cap (~$0.03/day)
- **Trigger:** mobile LCP >2500ms AND `featured_image` starts with `/images/defaults/`
- **Safety:** skip during recovery mode (GSC <800 imp/day)

### §4.8 — Loop H: Digest engagement per locale [DISTRIBUTION]

- **Producer:** Resend webhook with `tags.locale`
- **Consumer:** `scripts/feedback/digest-locale-stats.ts`, weekly
- **Measure:** open rate + CTR per `(locale × subject template)`
- **Downstream:** Maya updates `subject-templates.en.ts` and `subject-templates.zh.ts` independently
- **Safety:** n≥30 per `(locale, template)`; 4 weeks cold-start; **never A/B a ZH template against an EN baseline**

---

## §5 Idempotency, recovery, and freeze rules

### §5.1–§5.4 (unchanged from v2)

Re-running any stage on the same `Article` MUST produce byte-identical output. Stage 3 and 4 are pure; stage 5 is append-once-by-slug; stage 7→8 is skip-if-sent (Redis-backed by `digest-run-id × article-slug × audience`).

### §5.5 Forbidden during recovery mode (GSC <800 imp/day)

Single sequence, no sub-sections. Items 1–9 are SEO/data surfaces (v2); 10–12 are distribution routing (Maya v3); 13–19 are UX surfaces (Ken v3).

1. Canonical URL format changes
2. Hreflang topology changes
3. Sitemap structure changes
4. Robots.txt changes
5. Slug format changes
6. Locale routing / redirect rules
7. Admin publish path changes
8. Revalidation secret rotation
9. CDN cache-rule changes without purge plan
10. **Changing the translation-direction matrix (§3.A)**
11. **Changing digest locale routing (§3.1)**
12. **Activating ZH→EN translation — even if built — until recovery + 14 days**
13. **Introducing new webfonts**
14. **Adding above-fold client components (`"use client"` in hero)**
15. **Adding `<script async>` or `<script>` in `<head>` (Plausible is the standing exception)**
16. **Hero layout changes (Phase 2 NYT 3-col grid frozen)**
17. **Downgrading `next/image` → `<img>`**
18. **Loop G image churn (gated by UX-06 budget)**
19. **Removing TagIntro or SubscribeForm from any surface**

---

## §6 Compliance grid (CI-enforceable)

Items 1–20 are v2 DATA+SEO+I18N. Items 21–30 are UX (Ken). Items 31–37 are distribution routing (Maya).

1–20. _(v2, unchanged — frontmatter Zod, canonical probe, hreflang round-trip, sitemap smoke, CVE hard-gate, slug regex, source-grounding ≥80%, fact-check pass rate, dedup window, rehype-cve snapshot, i18n message-key coverage, revalidate secret present, admin noindex, dup-URL guard, 301 map, NEXT_LOCALE cookie OFF, CF status-code TTL, `transpilePackages` for next-mdx-remote, feed XML validity, robots parity.)_

21. One `<h1>` per page; h2→h3 cascade (HTML outline validator)
22. Flex/grid containers carry `min-w-0` or `overflow-hidden` (ripgrep lint + Playwright overflow gate)
23. axe-core: 0 critical, ≤2 serious on a sample of 10 pages
24. Lighthouse CI budgets: LCP ≤2500ms mobile 4G, CLS ≤0.1, INP ≤200ms
25. Interactive targets ≥44×44 (Playwright bbox)
26. ZH routes preload Noto Sans SC subset
27. og:image ≥1200×630 absolute URL (opengraph.xyz sample of 5)
28. Exactly one SearchDialog surface per route (grep)
29. SubscribeForm present on all content surfaces (Playwright)
30. 404/500 branded (synthetic probe)
31. Every write site (`translate-article`, `translate-publish`, `write-mdx`) calls `getTranslationDirection()`
32. `translate-direction.ts` unit test covers all 8 matrix cells
33. `send-digest.ts` reads both audience IDs; neither hardcoded
34. Snapshot: EN audience dry-run contains zero `/zh/` URLs
35. Snapshot: ZH audience dry-run contains zero `/en/` URLs
36. Snapshot: neither digest contains `ingest-only` slugs
37. CI lint: a source configured `seoIntent=rank-both ∧ sourceLanguage=zh` fails the config check

---

## §7 Open questions — ALL RESOLVED 2026-04-22

All 25 questions resolved. Resolutions recorded below for implementation reference. Authored in Phase A.6 approval.

### Philosophical throughline (Eric, 2026-04-22)

> **"Protect the GSC index. Fail loud at config. Pay for monitoring only when we have revenue to protect."**

Every resolution either (a) reduces fragile-index risk during canonicalization recovery, (b) catches errors before they cost tokens or publish slots, or (c) refuses infra spend disproportionate to our stage. Future decisions follow this logic.

### Resolutions

**Q1** — `qualityScore` seeding. **ACCEPT:** Maya hand-sets 13 sources (5 KEEP + 8 DROP from her Stage 1 audit); rest default 0.5. Editorial knowledge we have; not using it is waste.

**Q2** — ZH-native ingest scope. **Operator resolved:** bundle FreeBuf with contract work this cycle.

**Q3** — Loop B (CTR → prompt) authorship. **ACCEPT:** Manual Maya edits for 90 days, switch to auto after pattern stability. Auto-suggesting during GSC recovery could amplify bad signal.

**Q4** — URL helper signature. **Resolved inline (Vincent):** two functions — `articleUrl(article, locale)` returns path, `absoluteArticleUrl(article, locale)` returns full URL.

**Q5** — `Story.id` format. **ACCEPT:** Normalize to `${sourceId}-${sha256(url).slice(0,16)}`. One-time pain, permanent hygiene. Schedule the 1k-URL cache invalidation for a Saturday.

**Q6** — CI gate strictness. **OVERRIDE (Eric):** Warn-only for 1 week, then block. Day-1 block risks stalling Raymond on spec interpretation issues. One week is shortest calibration window that still honors "contracts mean something."

**Q7** — `runId` in HTML. **ACCEPT:** Defer until Loop A is live. Don't pay for infra we're not reading.

**Q8** — Recovery-mode lift authority. **ACCEPT:** Maya proposes → Eric approves → Sam executes.

**Q9** — Canonical source chain resolution. **ACCEPT:** First non-aggregator domain in chain; fall back to `url` if all-aggregators. Good enough; edge cases are <2% of corpus.

**Q10** — `featured_image` minimum bar. **ACCEPT:** SVG default acceptable v1. fal.ai hard-block ships in Phase 2 (blocked on Maya UX call anyway).

**Q11** — Tag-page noindex threshold. **ACCEPT:** Raise from <3 to <5, after recovery. Thin tag pages are canonicalization tax bait.

**Q12** — Loop F action for slug-churn casualties. **ACCEPT:** 308 forever default. 410 only on explicit per-batch operator approval. Slug churn is our fault, not users'.

**Q13** — `dateModified` on AI silent re-runs. **Resolved inline (Vincent):** bit-equal regen does NOT bump `dateModified`.

**Q14** — Hreflang to absent ZH versions. **ACCEPT:** Omit. `x-default`→EN pollutes ZH SERPs and we're recovery-sensitive.

**Q15** — ZH→EN translation (Cycle 2) timing. **ACCEPT:** AFTER quality-weighted dedup activation. EN is our GSC-indexed surface; don't pollute it with untested ZH→EN translation quality.

**Q16** — Digest cadence. **OVERRIDE (Eric):** Hold 2×/day until ZH audience >**200** (not >100). At 100 subs, signal is too noisy to detect fatigue. Engagement data from 2×/day also informs whether 1×/day is even the right move.

**Q17** — `rank-both ∧ zh` soft-block location. **ACCEPT:** Ingest-time (config-level). Fail loud at config. Saves DeepSeek spend. Philosophical throughline in one ruling.

**Q18** — FreeBuf default. **ACCEPT:** Starts at `ingest-only`. 30-day audit (Alex tracker). Then promote to `rank-zh`. New sources are guilty until proven innocent.

**Q19** — CWV measurement tool. **Operator resolved:** PSI only (Vercel Speed Insights N/A — we're on VPS not Vercel). Free; no $ commitment.

**Q20** — Phase 3 redesign timing. **DEFER (Eric):** Phase 3 typography pass deferred to Q3 2026 or when GSC clicks hit 50/day baseline, whichever first.

**Q21** — B-005 hero-search removal. **Operator resolved:** Ship now. 1-line change, no CWV risk.

**Q22** — `design-tokens.css`. **ACCEPT:** Single source for color/spacing/type. 30 scattered literals is a Phase 2 regression waiting to happen.

**Q23** — Dark mode commitment. **Operator resolved:** White mode default, dark on user click (current state — keep both).

**Q24** — Visual regression CI. **DEFER with cheap bridge (Eric):** Skip Percy/Chromatic ($600+/yr is disproportionate at 11 clicks/day). Raymond adds Playwright screenshot diffs for the 5 most critical pages only; CI-slow is fine at our volume. Revisit paid tools when we have revenue.

**Q25** — **Kill criterion for unified contracts project.** By **2026-07-22** (90 days from spec approval):

**PRIMARY gate (both must fail to trigger pause):**

- GSC <20 clicks/day **AND** newsletter <10 subs → pause pipeline contract work, pivot to distribution (XHS, LinkedIn, Discord, direct outreach)

**Operator refinement (2026-04-22):** keep BOTH metrics, not subs-only. AI pipeline is baseline infrastructure; GSC measures organic discovery, subs measure retention+conversion. Both measure different dimensions; collapsing to one hides failure modes.

**SUPPLEMENTARY amber-warning gates (Eric 2026-04-22, retained as signals not solo kills):**

- Newsletter subs <100 → warning (not pause-trigger alone)
- Human-editorial % of content <10% → moat concern (AI-slop differentiation failing)
- LinkedIn followers <250 → dark-social bet failed; revisit channel mix

**Byline deferred (operator 2026-04-22):** weekly human-bylined digest pushed to ~6-8 weeks out, after Phase B pipeline quality work stabilizes content. House byline ("ZCyberNews Editorial") until then. Loses ~4 weeks of byline compound on the 2026-07-22 clock; accepted trade-off to protect personal brand from shipping-shaky content.

**Positioning thesis (operator 2026-04-22):** Product is _"curation layer for security pros currently subscribing to 10+ RSS feeds in Feedly"_ — not a content producer competing with Krebs/BleepingComputer. Editorial moat = what we INCLUDE and EXCLUDE, not prose rewrites. This is the answer to the "AI slop" threat in the research memo: we ARE curation, not AI slop, even while using AI pipeline. Judgment is the product.

### Weekly metrics to monitor during rollout (Eric)

1. **Contract violation rate** — count of pipeline runs that would have been blocked by CI gate (during warn-only week 1) and actually blocked (after week 1 transition). **If >20% sustained after week 2, contracts are too strict or Raymond needs help.**
2. **GSC clicks 7-day rolling avg** — we're at 11/day in cliff recovery. **Want trending up by week 3 post-ship. If flat/down by week 4, pipeline contracts weren't the real lever — second-order problem exists.**

---

## §8 Architectural conflicts between Ken and Maya

**None found.** Verified:

- Maya's §5.5 items 10–12 cover routing/data; Ken's 13–19 cover rendering/CWV. Zero overlap.
- `PipelineContext` requires no new fields for either addendum (confirmed by Ken; Maya's additions flow through `seoIntent` + `sourceLanguage` already in v2).
- Loop G (Ken) writes to `featured_image` frontmatter; Loop H (Maya) reads Resend webhooks. Different data planes.
- Only coordination point: **UX-02 LCP image** and **Loop G backfill** both touch `featured_image`. Loop G is explicitly gated by UX-06 budget (§5.5 item 18) so they cannot fight.

---

## §9 Migration note

v3 replaces v2 on disk. Raymond begins the Phase B compliance audit against §6 items 1–37. Items 31–37 require the new `translate-direction.ts` module to land first; Raymond opens that as the first PR of the audit, with unit tests covering the 8 matrix cells before any write site is refactored to call it.

— Vincent, with Maya + Ken
