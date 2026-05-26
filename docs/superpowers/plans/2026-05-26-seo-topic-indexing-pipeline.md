# SEO Topic Indexing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the AI content pipeline from hourly auto-publishing into a search-first curation pipeline with manual review, selection reasons, SEO briefs, and later approved publishing.

**Architecture:** Keep the existing ingest, routing, clustering, editorial selector, SEO brief, generation, quality, and MDX writer modules. Add a review queue boundary between editorial selection and generation, run scheduled jobs in curate-only mode, and only allow generation/publishing after an approved candidate exists.

**Tech Stack:** Next.js 16, TypeScript, GitHub Actions, Vitest, RSS Parser, Vercel AI SDK, MDX content, existing `scripts/pipeline/*` modules, Search Console exports.

---

## Alex Cutline

Ship in recovery stages:

1. **Stage 1, now:** reduce the schedule, add curate-only mode, write review queue artifacts, and record reasons.
2. **Stage 2, next:** add admin/manual review status and approval records.
3. **Stage 3:** run the Day 0 to Day 14 taste calibration loop using operator ratings. This is a maximum 14-day training window, not a permanent review process.
4. **Stage 4:** generate only from approved candidates during calibration, then return scheduled runs to autonomous publishing after Day 14 unless quality degradation reopens review mode.
5. **Stage 5:** strengthen article SEO metadata, schema, topic hubs, news sitemap, and GSC feedback.

Non-goals for Stage 1:

- No public URL migration.
- No topic hub launch.
- No Google News sitemap yet.
- No admin UI yet.
- No auto-publish from scheduled runs.

## Files And Responsibilities

- Modify `.github/workflows/ai-content-pipeline.yml`: 3-times-daily schedule, scheduled curate-only mode, commit review queue artifacts, review-queue Telegram notice.
- Modify `scripts/pipeline/index.ts`: parse `--curate-only`, write review queue before generation, record selected candidates as review-required.
- Create `scripts/pipeline/review-queue.ts`: durable review queue writer and candidate package serializer.
- Create `scripts/pipeline/review-decision.ts`: validated review decision writer and taste-profile rebuild helper.
- Create `scripts/pipeline/review-candidate.ts`: CLI for approve/hold/digest/reject decisions before admin UI.
- Create `scripts/pipeline/approved-candidates.ts`: approved queue loader that rebuilds generation batches from reviewed candidate packages.
- Test `scripts/pipeline/__tests__/review-queue.test.ts`: queue path, manifest shape, candidate fields, reason preservation.
- Test `scripts/pipeline/__tests__/review-decision.test.ts`: decision validation, signal validation, and taste-profile rebuild.
- Test `scripts/pipeline/__tests__/approved-candidates.test.ts`: approved-only loading, reviewer metadata preservation, manifest path resolution, max article cap.
- Modify `scripts/pipeline/decision-matrix.ts`: only if needed to display review-required entries clearly.
- Update `docs/seo-topic-indexing-pipeline-tracker-2026-05-26.md`: Noah tracker and decision log.
- Later modify `app/admin/(protected)/*` and `app/api/admin/*`: manual queue review and approval flow.
- Later modify `scripts/ai/prompts/article.ts`, `scripts/ai/schemas/article-schema.ts`, `scripts/pipeline/write-mdx.ts`, and `lib/types.ts`: SEO metadata extraction and persistence.
- Later modify `app/sitemap.ts` and add news sitemap route: normal sitemap vs news sitemap split.

## Task 1: Create Noah Tracker

**Files:**

- Create: `docs/seo-topic-indexing-pipeline-tracker-2026-05-26.md`

- [ ] **Step 1: Add tracker header and source links**

Create a tracker with status, owner, current phase, last reviewed date, proposal link, and plan link.

- [ ] **Step 2: Add task board**

Include columns:

```markdown
| ID | Phase | Owner | Task | Status | Acceptance | Evidence |
```

Use statuses `Not started`, `In progress`, `Blocked`, `Done`, and `Deferred`.

- [ ] **Step 3: Add decision log**

Include columns:

```markdown
| ID | Date | Owner | Decision | Why | Review date |
```

- [ ] **Step 4: Add daily review packet**

Include queue path, selected candidates, rejected candidates, GSC export status, dry-run result, and decision needed.

## Task 2: Add Review Queue Writer

**Files:**

- Create: `scripts/pipeline/review-queue.ts`
- Test: `scripts/pipeline/__tests__/review-queue.test.ts`

- [ ] **Step 1: Write failing queue writer tests**

Create tests that build two candidates and assert:

- The writer creates `manifest.json`.
- It creates one JSON file per candidate.
- Manifest includes generated time, run ID, max candidates, candidate count, and candidate paths.
- Candidate JSON includes cluster key, lane, score, SEO brief, selection reasons, source URLs, reviewer status fields, a `0.01` to `1.0` taste rating field, and structured taste signals explaining why the candidate is liked or disliked.

Run:

```bash
npx vitest run scripts/pipeline/__tests__/review-queue.test.ts
```

Expected: fail because `review-queue.ts` does not exist yet.

- [ ] **Step 2: Implement `review-queue.ts`**

Define:

```ts
export interface ReviewQueueCandidate {
  candidateId: string;
  clusterKey: string;
  proposedTitle: string;
  lane: string;
  score: number;
  decision: string;
  selectionReasons: string[];
  sourceCount: number;
  sourceUrls: string[];
  sourceNames: string[];
  seoBrief: SeoBrief;
  reviewer: {
    status: "pending";
    reviewedBy: null;
    reviewedAt: null;
    decisionReason: null;
    tasteRating: null;
    tasteReason: null;
    positiveSignals: [];
    negativeSignals: [];
    selectedReasonTags: [];
    siteFitNotes: null;
    readerFitNotes: null;
    operatorNotes: null;
    calibrationRound: null;
  };
}
```

Define:

```ts
export function writeReviewQueue(
  candidates: ReviewQueueInput[],
  options?: { now?: Date; outputRoot?: string; runId?: string },
): ReviewQueueWriteResult;
```

The default output root is `data/editorial-queue`.

- [ ] **Step 3: Run queue writer tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/review-queue.test.ts
```

Expected: pass.

## Task 3: Add Curate-Only Pipeline Mode

**Files:**

- Modify: `scripts/pipeline/index.ts`
- Test: `scripts/pipeline/__tests__/review-queue.test.ts`

- [ ] **Step 1: Parse the new mode**

Add:

```ts
const CURATE_ONLY =
  args.includes("--curate-only") || process.env.CURATE_ONLY === "true";
```

Show `[CURATE ONLY]` in the startup banner.

- [ ] **Step 2: Write selected candidates to the queue**

After editorial selection and SEO brief creation, before generation:

```ts
if (CURATE_ONLY) {
  const queue = writeReviewQueue(
    batches.map((batch) => ({
      stories: batch.stories,
      selection: batch.selection,
      seoBrief: batch.seoBrief,
    })),
  );
  console.log(`[pipeline] Review queue written: ${queue.manifestPath}`);
  flushDecisionMatrix();
  return;
}
```

- [ ] **Step 3: Record selected candidates as review-required**

For each selected batch, add a decision matrix entry with:

- `outcome: "not_published"`
- `stage: "manual-review"`
- `decision: "review-required"`
- reasons from selection
- SEO query target from the SEO brief

- [ ] **Step 4: Verify no article generation happens**

Run:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --curate-only
```

Expected:

- Queue files are written under `data/editorial-queue/`.
- Console shows selected candidates.
- No MDX files are written under `content/`.
- Decision matrix reports selected candidates as not published and review-required.

## Task 4: Change Scheduled Workflow To Curate

**Files:**

- Modify: `.github/workflows/ai-content-pipeline.yml`

- [ ] **Step 1: Reduce cron**

Replace hourly cron with:

```yaml
- cron: "0 0,8,16 * * *"
```

Comment that this equals 08:00, 16:00, and 00:00 Asia/Shanghai.

- [ ] **Step 2: Add manual input**

Add:

```yaml
curate_only:
  description: "Curate review queue only; do not generate or publish articles"
  required: false
  type: boolean
  default: true
```

- [ ] **Step 3: Pass `--curate-only` for scheduled runs**

In the run step:

```bash
if [ "$CURATE_ONLY" = "true" ]; then
  ARGS="$ARGS --curate-only"
fi
```

Set:

```yaml
CURATE_ONLY: ${{ github.event_name == 'schedule' && 'true' || inputs.curate_only }}
```

- [ ] **Step 4: Commit queue artifacts**

Ensure detection includes:

```bash
data/editorial-queue/
```

Generated queue artifacts must be committed. They must not trigger deploy unless article titles were produced.

- [ ] **Step 5: Add review queue Telegram notice**

When `CURATE_ONLY=true`, send a decision matrix notification that says no public articles were published and the queue is ready for review.

## Task 5: Dry-Run And Artifact Cleanup

**Files:**

- Validate only; no intentional source edits.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/review-queue.test.ts scripts/pipeline/__tests__/editorial-selector.test.ts
```

- [ ] **Step 2: Run curate-only smoke**

Run:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --curate-only
```

Inspect selected lanes and queue output.

- [ ] **Step 3: Run required dry run**

Run:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --dry-run
```

Inspect selected story clusters and decision text.

- [ ] **Step 4: Restore validation-only artifacts**

If validation changes `data/feed-health.json`, restore it unless the task explicitly wants the telemetry update committed.

If curate-only creates sample queue files during local validation, delete them unless they are intended as fixtures.

## Task 6: Manual Review Records

**Files:**

- Create: `scripts/pipeline/review-decision.ts`
- Create: `scripts/pipeline/review-candidate.ts`
- Test: `scripts/pipeline/__tests__/review-decision.test.ts`
- Later create or modify admin API and UI files.

- [x] **Step 1: Define review state contract**

Use:

```ts
type ReviewStatus = "pending" | "approved" | "hold" | "digest-only" | "reject";
```

- [x] **Step 2: Persist reviewer decisions**

Approved records must include reviewer, reviewed time, decision reason, selected reason tags, taste rating from `0.01` to `1.0`, positive taste signals, negative filter signals, and freeform notes.

Implemented command:

```bash
npx tsx scripts/pipeline/review-candidate.ts \
  --file=data/editorial-queue/YYYY-MM-DD/run-HHMMZ/001-example.json \
  --status=approved \
  --reviewer=alex \
  --rating=0.92 \
  --reason="Hot topic with clear reader value" \
  --positive=hot-topic,reader-likely-cares \
  --tags=ai-security,identity \
  --round=day-3
```

The command validates status, rating, and known taste signals, writes the candidate JSON, and rebuilds `data/editorial-taste-profile.json` by default.

- [x] **Step 3: Track rejected candidates**

Rejected candidates remain useful training data and should not be deleted by default.

Current implementation status: review decisions can now be written to queue JSON without hand-editing files. `/admin/review` now provides the ergonomic admin layer over the same contract, with status selection, taste rating, decision reason, positive/negative signals, reason tags, freeform notes, and taste-profile rebuild through `app/api/admin/review-queue`.

## Task 7: Taste Calibration Loop

**Files:**

- Create: `scripts/pipeline/taste-profile.ts`
- Create: `scripts/pipeline/build-taste-profile.ts`
- Test: `scripts/pipeline/__tests__/taste-profile.test.ts`
- Create or modify: `data/editorial-taste-profile.json`
- Modify: `scripts/pipeline/editorial-selector.ts`
- Modify: `scripts/pipeline/review-queue.ts`
- Modify: `docs/seo-topic-indexing-pipeline-tracker-2026-05-26.md`

- [ ] **Step 1: Define rating rubric**

Use this scale for every reviewed candidate:

```text
1.00 = exactly the kind of article ZCyberNews should publish
0.90 = strong article; publish with minor/no edits
0.80 = liked and publishable; counts toward the quality target
0.60 = useful but wrong angle, weak packaging, or needs major edits
0.30 = weak candidate; probably digest-only or reject
0.01 = avoid this pattern in future selection
```

- [ ] **Step 2: Define taste reason taxonomy**

The reviewer should choose structured positive signals such as:

```text
hot-topic
historical-exploitation
active-exploitation
reader-likely-cares
defender-actionable
strong-source
original-angle
portfolio-balance
seo-opportunity
brand-fit
```

The reviewer should also choose negative filter signals such as:

```text
generic-rewrite
weak-source
low-reader-value
too-speculative
too-vendor-pr
stale-topic
no-actionable-angle
overcovered
wrong-site-fit
```

Freeform `tasteReason`, `siteFitNotes`, and `readerFitNotes` should preserve comments like "hot topic", "historical exploitation", "good for readers", "too generic", or "not for our site".

- [ ] **Step 3: Track review windows**

Use these calibration gates:

```text
Day 0-1: founder reviews many candidates and approves only a few favorites.
Day 3: first taste adjustment; more selected candidates should match founder preference.
Day 7: 70-80% of selected candidates should be rated >= 0.80.
Day 10: 80-90% of selected candidates should be rated >= 0.80.
Day 14: at least 90% of selected candidates should be rated >= 0.80.
```

- [ ] **Step 4: Write failing taste profile tests**

Test that reviewed candidates aggregate into:

```ts
{
  averageTasteRating: 0.87,
  likedRatio: 0.78,
  laneScores: { "ai-security": 0.9, ransomware: 0.82 },
  sourceScores: { "Krebs on Security": 0.94 },
  reasonTagScores: { "original-value": 0.91 },
  positiveSignalScores: { "hot-topic": 0.93, "historical-exploitation": 0.89 },
  negativeSignalScores: { "generic-rewrite": 0.12 }
}
```

- [ ] **Step 5: Implement taste profile aggregation**

Read reviewed queue JSON files and compute:

- Average taste rating.
- Liked ratio where `tasteRating >= 0.8`.
- Approval ratio.
- Hold/reject ratio.
- Lane score averages.
- Source score averages.
- Selection reason score averages.
- Positive taste signal score averages.
- Negative filter signal score averages.
- Top patterns to boost.
- Top patterns to suppress.

- [ ] **Step 5a: Add taste profile build command**

Add:

```bash
npx tsx scripts/pipeline/build-taste-profile.ts --queue-root=data/editorial-queue --output=data/editorial-taste-profile.json
```

Expected output is a JSON summary with reviewed candidate count, average taste rating, liked ratio, boost patterns, and suppress patterns.

- [ ] **Step 6: Feed taste profile into selector**

Adjust selector scoring using the taste profile:

- Boost lanes, sources, and reason tags with high ratings.
- Boost positive signals repeatedly attached to high-rated candidates.
- Suppress negative signals repeatedly attached to low-rated candidates.
- Suppress patterns repeatedly rated below `0.6`.
- Keep CVE safety rules and evidence gates stronger than taste boosts.
- Record taste-profile influence in the decision matrix.

Current implementation status: `scripts/pipeline/taste-profile.ts`, `scripts/pipeline/build-taste-profile.ts`, `scripts/pipeline/review-decision.ts`, `scripts/pipeline/review-candidate.ts`, selector taste-profile scoring, and unit tests are implemented in the Stage 1/3 branch. Admin UI and live reviewed queue data are still pending.

- [x] **Step 7: Add autonomy gate**

Routine manual review ends after Day 14. Use the Day 14 review to choose how strict the autonomous run should be, not whether manual review continues indefinitely.

Autonomous mode should prefer normal schedule if:

- The last review window has at least 90% candidates rated `>= 0.8`.
- No serious fact-check, attribution, sitemap, canonical, or GSC regression is open.
- Alex or Eric approves the transition.

If Day 14 misses the 90% target, still end routine manual review, but use safer autonomous settings:

- Lower max articles.
- Stricter quality gates.
- More digest-only decisions.
- Daily sample audit instead of full manual review.

- [x] **Step 8: Add degradation trigger**

After autonomy starts, re-enable operator review if any of these happen:

- Rolling 20-candidate liked ratio drops below 85%.
- Average taste rating drops below 0.85.
- Two auto-published articles in one day are manually rejected after the fact.
- GSC indexing or CTR degrades materially for the new cohort.
- A serious attribution or quality incident occurs.

Current implementation status: `scripts/pipeline/autonomy-gate.ts` evaluates the 14-day calibration window, Day 14 liked ratio, average taste rating, Alex/Eric transition approval, open regression flags, GSC degradation, serious incident flags, same-day rejection count, and rolling 20-candidate quality. Scheduled workflow runs set `AUTONOMY_GATE=true`; during calibration the gate keeps curate-only mode, after Day 14 it allows normal autonomous mode when quality and approval gates are clean, uses strict autonomous mode with a lower article cap when targets are missed, and reopens review mode only when degradation or regression signals are present.

## Task 8: Approved Generation Path

**Files:**

- Modify: `scripts/pipeline/index.ts`
- Create: `scripts/pipeline/approved-candidates.ts`
- Test: `scripts/pipeline/__tests__/approved-candidates.test.ts`
- Modify: `scripts/pipeline/write-mdx.ts`
- Modify: `lib/types.ts`
- Modify: `.github/workflows/ai-content-pipeline.yml`

- [x] **Step 1: Load approved candidate packages**

Read approved queue JSON files and rebuild the story batch, selection, and SEO brief.

- [x] **Step 2: Generate only approved candidates**

Add a mode such as:

```bash
npx tsx scripts/pipeline/index.ts --approved-queue=data/editorial-queue/YYYY-MM-DD/run-HHMM
```

- [x] **Step 3: Preserve reviewer metadata**

Generated MDX frontmatter should include selection reason and reviewer metadata.

Current implementation status: `--approved-queue` loads only candidates with `reviewer.status="approved"` plus a valid `tasteRating`, `decisionReason`, and reviewer. Pending/rejected/invalid candidates are written to the decision matrix as not published. Generated MDX receives `editorial_*` review fields, and the GitHub Actions workflow has a manual `approved_queue` input for publishing a reviewed run.

## Task 9: SEO Metadata Schema

**Files:**

- Modify: `scripts/ai/schemas/article-schema.ts`
- Modify: `scripts/ai/prompts/article.ts`
- Modify: `scripts/pipeline/write-mdx.ts`
- Modify: `lib/types.ts`
- Test: relevant schema/frontmatter tests.

- [x] **Step 1: Add SEO output fields**

Add primary query, search intent, title promise, meta promise, target hub, internal link targets, image alt, and news sitemap eligibility.

- [x] **Step 2: Persist fields to MDX frontmatter**

Write fields with stable snake_case keys.

- [x] **Step 3: Parse fields publicly**

Update frontmatter schema so public consumers can safely use the fields.

Current implementation status: `GeneratedArticleSchema` now requires `seo_query_target`, `seo_intent`, `seo_title_promise`, `seo_meta_promise`, `target_hub`, `internal_link_targets`, `featured_image_alt`, and `news_sitemap_eligible`. The article prompt requests these fields, `write-mdx.ts` persists them to frontmatter, and `ArticleFrontmatterSchema` parses them for public consumers. The generation layer can backfill missing SEO fields from the existing SEO brief before schema validation.

## Task 10: News Sitemap

**Files:**

- Add route under `app/` for news sitemap output.
- Modify `app/robots.ts` if needed to expose the news sitemap.
- Test sitemap eligibility.

- [x] **Step 1: Add eligibility helper**

Only approved public news articles from the last 48 hours qualify.

- [x] **Step 2: Generate XML**

Use canonical URLs, publication name, language, publication date, and title.

- [x] **Step 3: Exclude evergreen and older articles**

Do not pollute the news sitemap with stale or non-news URLs.

Current implementation status: `/sitemaps/news.xml` now renders a Google News XML sitemap from `lib/news-sitemap.ts`. Eligibility requires `news_sitemap_eligible: true`, a public/indexable article, matching locale, valid publication date, and age within 48 hours. `robots.txt` advertises both `/sitemap.xml` and `/sitemaps/news.xml`.

## Task 11: Topic Hubs And Internal Links

**Files:**

- Add topic hub pages under `app/[locale]/topics/[hub]/page.tsx`.
- Modify navigation/internal link surfaces as needed.
- Modify article generation prompt and renderer for internal link targets.

- [x] **Step 1: Add hub eligibility thresholds**

Publish a hub only when it has enough quality content and crawlable internal links.

- [x] **Step 2: Add hub pages**

Use stable paths such as `/en/topics/ransomware/` and `/en/topics/ai-security/`.

- [x] **Step 3: Add crawlable article-to-hub links**

Use descriptive `<a href>` anchor text, not JavaScript-only links.

Current implementation status: `lib/topic-hubs.ts` defines eight topic hubs: ransomware, malware, APT groups, AI security, active CVEs, breaches, defender operations, and cyber policy. `/[locale]/topics/[hub]` renders only hubs with at least five public matching articles, `/sitemap.xml` includes public hubs, and article pages render crawlable hub links from `target_hub` and `internal_link_targets`.

## Task 12: GSC Feedback Loop

**Files:**

- Create: `scripts/pipeline/gsc-feedback.ts`
- Create or modify: `data/gsc-demand-hints.json`
- Create or modify: docs tracker.

- [x] **Step 1: Normalize GSC exports**

Support page, query, clicks, impressions, CTR, position, indexing status, and sitemap status.

- [x] **Step 2: Feed demand hints**

Use impressions, CTR, and indexed/not-indexed outcomes to tune search demand and rewrite queues.

- [ ] **Step 3: Record weekly review**

Noah records what changed and which selector weights changed because of evidence.

Current implementation status: `scripts/pipeline/gsc-feedback.ts` imports a manual Search Console CSV export and writes `data/gsc-demand-hints.json`, which `scripts/pipeline/search-demand.ts` already prefers over static hints when present. The importer handles query/page rows, clicks, impressions, CTR, position, and indexing status; it filters branded/navigation noise before turning query demand into entity weights. Weekly review still needs a real export from Maya/Search Console.

## Verification Gate For Any Pipeline Change

Always run:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --dry-run
```

Also run the smallest relevant unit tests. If dry-run or curate-only validation changes `data/feed-health.json`, restore that artifact before handoff unless intentionally updating feed health.
