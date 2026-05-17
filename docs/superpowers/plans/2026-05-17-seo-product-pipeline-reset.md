# SEO Product Pipeline Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a search-first English publishing pipeline that decides what deserves a public article before generation, using source trust, evidence depth, search demand, topic balance, and SEO briefs.

**Architecture:** Add a pre-generation editorial decision layer between routing/clustering and generation. Keep the existing post-generation fact, quality, duplicate, and indexability gates, but feed them with structured evidence packets and SEO briefs. Freeze new Chinese publishing in the recovery phase while preserving existing `/zh` URLs.

**Tech Stack:** Next.js 16, TypeScript, Vitest, RSS Parser, Vercel AI SDK, MDX content, existing `scripts/pipeline/*` modules, GSC exports, existing SEO audit scripts.

---

## Alex Tracker

| ID     | Lane                                  | Owner                | Status  | Acceptance                                                                      |
| ------ | ------------------------------------- | -------------------- | ------- | ------------------------------------------------------------------------------- |
| SEO-R1 | Product policy and English-only reset | Alex + Maya          | Planned | Publish policy defines public, digest-only, research-more, reject               |
| SEO-R2 | Source trust registry                 | Vincent + Raymond    | Planned | Sources have explicit authority/originality/noise/verification metadata         |
| SEO-R3 | Evidence packet                       | Raymond              | Planned | Candidate clusters produce structured facts and uncertainty before generation   |
| SEO-R4 | Search-first selector                 | Raymond + Maya       | Planned | Selection uses evidence, trust, demand, freshness, differentiation, portfolio   |
| SEO-R5 | SEO brief contract                    | Maya + Raymond       | Planned | Every public generated article has a brief with query target and internal links |
| SEO-R6 | GSC feedback loop                     | Maya + Noah          | Planned | Weekly export feeds demand hints and title/meta rewrite queue                   |
| SEO-R7 | Topic hubs and internal links         | Ken + Maya + Raymond | Planned | Public articles map to hubs and get internal link opportunities                 |
| SEO-R8 | Verification and deploy gates         | Raymond + Sam        | Planned | Dry run, unit tests, SEO audit, production smoke required before push           |

## Files And Responsibilities

- Create `scripts/pipeline/source-trust.ts`: source trust types, defaults, and scoring helpers.
- Modify `data/rss-sources.json`: add trust metadata to each enabled source.
- Modify `scripts/sources/feeds.ts`: type source trust metadata.
- Create `scripts/pipeline/evidence-packet.ts`: build structured facts and uncertainty from clustered stories.
- Create `scripts/pipeline/search-demand.ts`: load GSC/query hints and entity demand rules.
- Create `scripts/pipeline/editorial-selector.ts`: combine trust, evidence, demand, freshness, differentiation, and portfolio scoring.
- Create `scripts/pipeline/seo-brief.ts`: produce query-first brief before generation.
- Modify `scripts/pipeline/index.ts`: call selector and SEO brief before `generateArticle`.
- Modify `scripts/ai/prompts/article.ts`: accept/use the SEO brief and evidence packet.
- Modify `scripts/pipeline/translate-direction.ts` or routing config: freeze new ZH publication in recovery mode.
- Modify `scripts/pipeline/decision-matrix.ts`: include trust/evidence/demand/portfolio fields.
- Add tests under `scripts/pipeline/__tests__/`: source trust, evidence packet, editorial selector, SEO brief, English-only routing.
- Create `docs/seo-product-reset-status-2026-05-17.md`: Noah-facing status tracker.

## Task 1: Lock Recovery Publish Policy

**Files:**

- Create: `docs/seo-product-reset-status-2026-05-17.md`
- Modify: `docs/superpowers/specs/2026-05-17-seo-product-pipeline-reset-design.md`

- [ ] **Step 1: Add status tracker**

Create a compact tracker with these sections:

```markdown
# SEO Product Reset Status - 2026-05-17

Status: Planned
Owner: Alex
Docs: Noah
Engineering: Raymond
SEO: Maya

## Current Decision

ZCyberNews is entering an English-first SEO recovery phase. New public publishing should prioritize English articles with clear source evidence, query-first packaging, and sitemap eligibility. Existing Chinese URLs remain live, but new Chinese generation is frozen unless reopened by a separate migration plan.

## Phase Gates

| Phase | Gate                           | Owner         | Status  |
| ----- | ------------------------------ | ------------- | ------- |
| 1     | Pre-generation selector ships  | Raymond       | Planned |
| 2     | GSC demand loop active         | Maya          | Planned |
| 3     | Hubs/internal links active     | Ken + Raymond | Planned |
| 4     | Production monitoring reviewed | Sam           | Planned |

## Daily Review

- Published articles
- Held for research
- Digest-only items
- Rejected items
- Top source failures
- Top search opportunities
- Production smoke result
```

- [ ] **Step 2: Commit docs baseline**

Run:

```bash
git add docs/superpowers/specs/2026-05-17-seo-product-pipeline-reset-design.md docs/superpowers/plans/2026-05-17-seo-product-pipeline-reset.md docs/seo-product-reset-status-2026-05-17.md
git commit -m "docs: plan SEO product pipeline reset"
```

Expected: one docs-only commit on the task branch.

## Task 2: Add Source Trust Metadata

**Files:**

- Create: `scripts/pipeline/source-trust.ts`
- Modify: `scripts/sources/feeds.ts`
- Modify: `data/rss-sources.json`
- Test: `scripts/pipeline/__tests__/source-trust.test.ts`

- [ ] **Step 1: Write failing tests for source trust defaults**

Create tests covering:

```ts
import { describe, expect, it } from "vitest";
import { scoreSourceTrust } from "../source-trust.js";

describe("source trust scoring", () => {
  it("prioritizes primary and government sources over syndication", () => {
    expect(
      scoreSourceTrust({ sourceClass: "government", authorityScore: 0.95 })
        .score,
    ).toBeGreaterThan(
      scoreSourceTrust({ sourceClass: "reputable-media", authorityScore: 0.7 })
        .score,
    );
  });

  it("penalizes marketing and webinar noise", () => {
    const scored = scoreSourceTrust({
      sourceClass: "vendor-advisory",
      authorityScore: 0.8,
      noiseRisk: "webinar",
    });
    expect(scored.penalties).toContain("noise:webinar");
  });
});
```

- [ ] **Step 2: Implement `source-trust.ts`**

Define:

```ts
export type SourceClass =
  | "primary"
  | "government"
  | "vendor-advisory"
  | "security-research"
  | "reputable-media"
  | "structured-vulnerability"
  | "community"
  | "social"
  | "forum"
  | "unknown";

export type NoiseRisk =
  | "none"
  | "press-release"
  | "webinar"
  | "recap"
  | "syndication"
  | "unknown";
export type VerificationRole =
  | "primary-evidence"
  | "corroboration"
  | "context"
  | "weak-signal"
  | "ingest-only";
```

Score with explicit weights and return `{ score, boosts, penalties }`.

- [ ] **Step 3: Update source types**

Add optional fields to `FeedSource`:

```ts
sourceClass?: SourceClass;
authorityScore?: number;
originalityScore?: number;
noiseRisk?: NoiseRisk;
verificationRole?: VerificationRole;
```

- [ ] **Step 4: Update enabled sources conservatively**

Assign high authority to CISA, NVD, vendor advisories, and original research feeds. Assign lower originality/noise penalties to broad news/recap/vendor marketing feeds.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/source-trust.test.ts scripts/__tests__/audit-feed-sources.test.ts
```

Expected: tests pass.

## Task 3: Build Evidence Packets

**Files:**

- Create: `scripts/pipeline/evidence-packet.ts`
- Test: `scripts/pipeline/__tests__/evidence-packet.test.ts`

- [ ] **Step 1: Write failing evidence tests**

Cover CVE extraction, actor/victim/product extraction, source count, primary-source presence, concrete facts, and uncertainty flags.

- [ ] **Step 2: Implement evidence packet type**

Create:

```ts
export interface EvidencePacket {
  clusterKey: string;
  sourceUrls: string[];
  sourceNames: string[];
  sourceCount: number;
  entities: {
    cves: string[];
    products: string[];
    vendors: string[];
    actors: string[];
    victims: string[];
    sectors: string[];
    regions: string[];
  };
  facts: {
    cvssScores: number[];
    exploitStatus: "exploited" | "poc" | "patched" | "unknown";
    recordCounts: string[];
    affectedVersions: string[];
    iocSignals: string[];
    ttpSignals: string[];
  };
  uncertainty: string[];
}
```

- [ ] **Step 3: Reuse existing deterministic extractors**

Use `extractCVEs`, `extractThreatActor`, IOC extraction, and title/excerpt text. Do not add LLM calls in this module.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/evidence-packet.test.ts scripts/pipeline/__tests__/extract-iocs.test.ts scripts/pipeline/__tests__/threat-actor-extraction.test.ts
```

Expected: tests pass.

## Task 4: Add Search Demand And Topic Portfolio

**Files:**

- Create: `scripts/pipeline/search-demand.ts`
- Create: `data/search-demand-hints.json`
- Test: `scripts/pipeline/__tests__/search-demand.test.ts`

- [ ] **Step 1: Create demand hints file**

Start with static hints from prior GSC audits:

```json
{
  "updatedAt": "2026-05-17",
  "entities": {
    "microsoft": 0.8,
    "windows": 0.8,
    "exchange": 0.8,
    "chrome": 0.75,
    "github": 0.75,
    "ransomware": 0.7,
    "shinyhunters": 0.7,
    "mcgraw hill": 0.65
  },
  "patterns": {
    "CVE-": 0.8,
    "KB": 0.7,
    "zero-day": 0.85,
    "actively exploited": 0.9,
    "data breach": 0.75
  }
}
```

- [ ] **Step 2: Implement demand scorer**

Return `{ score, matchedHints }` from title, excerpt, tags, and evidence entities.

- [ ] **Step 3: Add portfolio lanes**

Define lanes:

```ts
export type TopicLane =
  | "vulnerabilities"
  | "ransomware"
  | "apt-state-actors"
  | "breaches"
  | "malware"
  | "ai-security"
  | "defender-ops"
  | "policy";
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/search-demand.test.ts
```

Expected: tests pass.

## Task 5: Implement Editorial Selector

**Files:**

- Create: `scripts/pipeline/editorial-selector.ts`
- Modify: `scripts/pipeline/index.ts`
- Modify: `scripts/pipeline/decision-matrix.ts`
- Test: `scripts/pipeline/__tests__/editorial-selector.test.ts`

- [ ] **Step 1: Write selection tests**

Cover:

- multi-source primary evidence beats single-source recap.
- exploited CVE beats low-impact CVE.
- ransomware/APT/breach stories are not crowded out by NVD volume.
- digest-only items do not reach generation.
- research-more items preserve the evidence reason.

- [ ] **Step 2: Implement selector output**

```ts
export type PublishDecision =
  | "publish-now"
  | "research-more"
  | "digest-only"
  | "reject";

export interface EditorialSelection {
  clusterKey: string;
  decision: PublishDecision;
  score: number;
  lane: TopicLane;
  reasons: string[];
  evidenceScore: number;
  trustScore: number;
  demandScore: number;
  freshnessScore: number;
  differentiationScore: number;
  portfolioScore: number;
}
```

- [ ] **Step 3: Integrate before generation**

In `scripts/pipeline/index.ts`, replace direct `clusters.slice(0, MAX_ARTICLES)` selection with `selectEditorialCandidates(clusters, { maxArticles: MAX_ARTICLES })`.

- [ ] **Step 4: Update decision matrix**

Record selector score fields for every cluster, including not-published decisions.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/editorial-selector.test.ts scripts/pipeline/__tests__/decision-matrix.test.ts scripts/pipeline/__tests__/story-clustering.test.ts
```

Expected: tests pass.

## Task 6: Add SEO Brief Contract

**Files:**

- Create: `scripts/pipeline/seo-brief.ts`
- Modify: `scripts/ai/prompts/article.ts`
- Modify: `scripts/pipeline/generate-article.ts`
- Modify: `scripts/pipeline/write-mdx.ts`
- Test: `scripts/pipeline/__tests__/seo-brief.test.ts`

- [ ] **Step 1: Write SEO brief tests**

Cover primary target selection in this priority order: CVE, KB, product, actor, victim, named incident, generic lane.

- [ ] **Step 2: Implement brief type**

```ts
export interface SeoBrief {
  primaryQueryTarget: string;
  searchIntent:
    | "breaking-news"
    | "patch-guidance"
    | "incident-impact"
    | "technical-analysis"
    | "explainer";
  titlePromise: string;
  metaPromise: string;
  articleType: string;
  requiredEntities: string[];
  internalLinkTargets: string[];
  targetHub: string | null;
  sitemapEligible: boolean;
}
```

- [ ] **Step 3: Inject brief into generation prompt**

Update `buildArticlePrompt` to include a short `SEO BRIEF` block before article rules.

- [ ] **Step 4: Persist brief summary in frontmatter**

Add `seo_query_target`, `seo_intent`, and `target_hub` to generated article frontmatter if present.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/seo-brief.test.ts scripts/pipeline/__tests__/generate-article-parser.test.ts scripts/pipeline/__tests__/publish-quality-gate.test.ts
```

Expected: tests pass.

## Task 7: Freeze New Chinese Publishing In Recovery Mode

**Files:**

- Modify: `scripts/pipeline/translate-direction.ts`
- Modify: `scripts/pipeline/routing.ts`
- Test: `scripts/pipeline/__tests__/translate-direction.test.ts`
- Test: `scripts/pipeline/__tests__/routing.test.ts`

- [ ] **Step 1: Add recovery-mode tests**

Set `SEO_RECOVERY_EN_ONLY=true` and assert English stories publish EN only, ZH-native stories ingest signal only, and translation is skipped by policy.

- [ ] **Step 2: Implement env-controlled policy**

When `SEO_RECOVERY_EN_ONLY=true`, return no `translate-and-publish-both` actions.

- [ ] **Step 3: Update decision matrix language**

Record `translation skipped: seo recovery en only` rather than a warning.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/translate-direction.test.ts scripts/pipeline/__tests__/routing.test.ts
```

Expected: tests pass.

## Task 8: GSC Feedback Loop

**Files:**

- Create: `scripts/seo/import-gsc-performance.ts`
- Create: `data/gsc-demand-hints.json`
- Test: `scripts/seo/__tests__/import-gsc-performance.test.ts`
- Docs: `docs/seo-product-reset-status-2026-05-17.md`

- [ ] **Step 1: Write importer tests**

Use fixture CSV rows for Pages and Queries exports. Assert normalized entities, clicks, impressions, CTR, average position, and zero-click opportunities.

- [ ] **Step 2: Implement importer**

Accept a local export directory or zip path, parse CSVs, and write `data/gsc-demand-hints.json`.

- [ ] **Step 3: Connect search-demand scorer**

Load `data/gsc-demand-hints.json` when present, falling back to `data/search-demand-hints.json`.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run scripts/seo/__tests__/import-gsc-performance.test.ts scripts/pipeline/__tests__/search-demand.test.ts
```

Expected: tests pass.

## Task 9: Topic Hubs And Internal Links

**Files:**

- Create: `lib/topic-hubs.ts`
- Modify: `app/[locale]/categories/[category]/page.tsx`
- Modify: article page components that render related links
- Test: relevant content/SEO tests

- [ ] **Step 1: Define hub registry**

Start with:

- Microsoft vulnerabilities
- Active exploited CVEs
- Ransomware groups
- Data breaches
- SaaS breaches
- Malware loaders
- AI security
- Supply chain attacks

- [ ] **Step 2: Add internal link suggestions**

Use tags, category, CVEs, actors, products, and target hub from the SEO brief.

- [ ] **Step 3: Keep low-signal hubs out of sitemap**

Only index hub pages with enough unique intro copy and article count.

- [ ] **Step 4: Run SEO audit**

Run:

```bash
npm run seo:audit:all
```

Expected: no critical sitemap/indexability failures.

## Task 10: Verification And Rollout

**Files:**

- Modify only files changed by previous tasks
- Docs: update `docs/seo-product-reset-status-2026-05-17.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run scripts/pipeline/__tests__/source-trust.test.ts scripts/pipeline/__tests__/evidence-packet.test.ts scripts/pipeline/__tests__/search-demand.test.ts scripts/pipeline/__tests__/editorial-selector.test.ts scripts/pipeline/__tests__/seo-brief.test.ts scripts/pipeline/__tests__/translate-direction.test.ts scripts/pipeline/__tests__/routing.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full fast QA**

Run:

```bash
npm run qa:fast
```

Expected: typecheck and test suite pass.

- [ ] **Step 3: Run required pipeline dry run**

Run:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --dry-run
```

Expected: command exits 0; selected clusters show varied topic lanes and decision reasons.

- [ ] **Step 4: Inspect and revert dry-run artifacts**

Run:

```bash
git status --short
```

If `data/feed-health.json` or cache files changed only because of dry run, revert or exclude them before commit.

- [ ] **Step 5: Run SEO audit**

Run:

```bash
npm run seo:audit:all
```

Expected: no critical discoverability regressions.

- [ ] **Step 6: Commit implementation**

Run:

```bash
git add scripts data docs lib app
git commit -m "feat: add search-first editorial pipeline"
```

Expected: one implementation commit after the docs commit.

- [ ] **Step 7: Push and open PR**

Run:

```bash
git push -u origin codex/seo-product-reset-plan
```

PR title:

```text
feat: add search-first editorial pipeline
```

PR checklist:

- Source trust scoring tested
- Evidence packet tested
- Search demand scoring tested
- Editorial selector tested
- SEO brief tested
- English-only recovery mode tested
- Pipeline dry run reviewed
- SEO audit reviewed

## Implementation Notes

- Keep the current `codex/fix-pipeline-topic-matrix` work separate; do not copy dirty files from the main checkout without review.
- Use existing modules wherever possible. The reset should add a pre-generation layer, not rewrite the whole pipeline in one swing.
- Do not remove existing `/zh` content or routes in this plan.
- Treat GSC traffic recovery as a lagging signal. The first proof is better decisions, fresh canonical sitemap entries, and fewer thin public pages.
