# Pipeline Chain Audit — Living Tracker

**Started:** 2026-04-21
**Lead PM:** Alex
**Methodology:** Bottom-up pass (Stage 1→9) → Top-down pass (Stage 9→1) → Synthesis → Implement → Repeat
**Why:** AI content pipeline is the company's CORE. Today's quality failure (6 hedging articles) exposed that gates only audit ONE link. Need to audit the full value chain — sources in, indexed/read content out — and find every broken contract between adjacent links. Bottom-up surfaces in-stage defects; top-down surfaces inter-stage contract gaps.

---

## The chain (9 stages)

```
[1] RSS sources (35 feeds, data/rss-sources.json)
     ↓
[2] ingest-rss.ts (parse, normalize, retry, timeout)
     ↓
[3] dedup.ts + cache.ts (story-level dedup, processed-URL state)
     ↓
[4] ENGINE (classifySourceRichness → generateWithFallback → post-process → fact-check → translate-article → write-mdx)
     ↓
[5] write-mdx + git commit/push + revalidate orchestration (pipeline/index.ts)
     ↓
[6] Render layer (app/[locale]/articles/[slug]/page.tsx + JsonLd.tsx + ISR)
     ↓
[7] Discovery layer (sitemap.ts + robots.ts + api/feed)
     ↓
[8] Distribution (notify-discord, send-digest twice daily)
     ↓
[9] Feedback (GSC indexing, Plausible analytics, kill-criterion KPIs)
     ↓
[goal] Reader trust → newsletter sub → sponsor → revenue
```

---

## Pass 1 — Bottom-up audit (stage-by-stage in isolation)

### Stage 1 — RSS sources (35 feeds)

- **Auditor:** Maya (Marketing/SEO lens — source curation + content fit)
- **Status:** ✅ done 2026-04-21
- **Findings (top-line):** Source list is ~30% noise. Vendor PR feeds pollute pipeline. ZH locale has zero native sources. No exploit/PoC feed. No ICS/OT feed.

#### Top 5 to KEEP

1. **BleepingComputer** — best signal-to-noise; non-negotiable
2. **The Hacker News** — high cadence (3-5/day), CVE-rich, breaks stories early
3. **Krebs on Security** — investigative depth, brand authority halo
4. **CISA KEV (JSON feed)** — gold-standard structured data; only feed satisfying new CVE-required gate without LLM guesswork
5. **Google Project Zero** — elite zero-day write-ups with CVE + technical depth, E-E-A-T defensible

- _Honorable mentions:_ Kaspersky Securelist, Unit 42, Mandiant (re-enable), WeLiveSecurity — best APT/threat-actor sources

#### Top 8 to DROP / DISABLE

1. **Fortinet FortiGuard Labs** — confirmed today's quality polluter (vendor patch summaries, no CVE detail)
2. **Microsoft Security Blog** (already disabled — keep disabled; marketing-heavy)
3. **Sophos News** (already disabled — keep)
4. **CrowdStrike Blog** — 1 in 5 posts is real research, others sales material; OR whitelist `/blog/threat-research/`
5. **Proofpoint** — webinar/analyst-report promos; restrict or disable
6. **Qualys Threat Research** — duplicates Patch Tuesday already covered by ZDI/Rapid7/THN
7. **CyberSecurity News** — low-authority aggregator that re-writes BleepingComputer/THN
8. **Help Net Security** — vendor surveys + product roundups, rarely real incidents

Net cut: ~6 active feeds (some already disabled). No coverage loss because dropped feeds duplicate BleepingComputer/THN/Krebs.

#### Top 5 to ADD

1. **The Record by Recorded Future** — `https://therecord.media/feed` — best independent journalism on nation-state/ransomware
2. **Volexity Threat Research** — `https://www.volexity.com/blog/feed/` — small shop, consistent zero-day discoveries (Ivanti, Atlassian, Exchange)
3. **Censys Research** — `https://censys.com/blog/rss/` — internet-scan based, infrastructure/IOC angles
4. **NVD CVE Recent Feed** — `https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json` — source of truth for CVE-gated `vulnerabilities` category
5. **FreeBuf** — `https://www.freebuf.com/feed` — Chinese-language community; closes ZH origination gap (or Anquanke `https://www.anquanke.com/rss`)

#### Three source-taxonomy gaps

1. **No native Chinese-language source** despite ZH = 50% of publishing
2. **No exploit/PoC feed** (Exploit-DB, `trickest/cve` GitHub releases) — `vulnerabilities` category needs PoC-availability signal
3. **No ICS/OT-specific feed** (Dragos `https://www.dragos.com/blog/feed/`) — high-CPM B2B niche we currently miss entirely

#### KILLER RECOMMENDATION — vendor-PR filter at ingest (saves tokens AND quality)

```js
// Title regex (case-insensitive, vendor-PR pattern)
/^[A-Z][\w\.&\- ]+ (Announces|Launches|Unveils|Introduces|Releases|Expands|Partners|Achieves|Joins|Names|Appoints|Acquires|Wins|Recognized|Earns|Celebrates|Welcomes)\b/i;

// Plus description-field filter
const PR_KEYWORDS =
  /webinar|whitepaper|register now|download the report|press release/i;
const HAS_CVE = /CVE-\d{4}-\d{4,7}/;
// Drop if PR_KEYWORDS match AND !HAS_CVE → ~95% precision for vendor PR

// Plus: holding-queue for vulnerabilities category without CVE
if (story.targetCategory === "vulnerabilities" && !HAS_CVE.test(story.body)) {
  enqueueHoldingQueue(story); // don't spend DeepSeek tokens on guaranteed-reject content
}
```

This is the **single highest-leverage change** — it operates BEFORE token spend. Complements the existing fact-check CVE gate (shift-left vs Maya's current shift-right placement).

#### Recommended actions (sequenced)

- **A1.** Disable 5 feeds (Fortinet, CrowdStrike, Proofpoint, Qualys, Help Net, CyberSecurity News) — `data/rss-sources.json` flip `enabled: false`
- **A2.** Add 4 feeds (The Record, Volexity, Censys, NVD) — append to `data/rss-sources.json`
- **A3.** Add 1 ZH feed (FreeBuf or Anquanke) — separate evaluation
- **A4.** Ship vendor-PR title regex + description filter at ingest layer (Stage 2 work — Raymond)
- **A5.** Implement vulns-without-CVE holding queue (engine-stage change — defer to T1.4 already in program)

#### Open questions for next pass

- Do we attempt to backfill ZH-origination via FreeBuf, or accept "translation-only" ZH for now?
- Should we whitelist CrowdStrike's `/blog/threat-research/` URL pattern instead of full disable?

### Stage 2 — ingest-rss.ts

- **Auditor:** Raymond (focused engineering pass)
- **Status:** ✅ done 2026-04-21
- **Findings (top 8 ranked by ROI):**

| #   | file:line | Change                                                                                                                                                   | Severity     | Effort |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| 1   | `:32`     | **Wall-clock timeout per source** — `Promise.race([parseURL, timeoutPromise])` (socket timeout ≠ wall-clock; slow feed hangs whole `Promise.allSettled`) | **CRITICAL** | XS     |
| 2   | `:33`     | **Vendor-PR filter** at end of `.map` (Maya's Stage 1 rec) — new `scripts/pipeline/filters/vendor-pr.ts`                                                 | HIGH         | S      |
| 3   | `:33`     | **Per-source `maxItems`** instead of uniform 25 — read `source.maxItems ?? 25` (additive, default preserves volume)                                      | HIGH         | XS     |
| 4   | `:94-98`  | **Feed health observability** — append to `data/feed-health.json` (last N=20 runs per source); Sam's daily digest reads                                  | HIGH         | S      |
| 5   | `:33`     | Story carries no `sourceId` (only `sourceName`) — additive Story extension for stable keying                                                             | MEDIUM       | XS     |
| 6   | `:33`     | Story missing `fetchedAt`/`isVendor`/`qualityScore` — Stage 4 needs these for selection weighting                                                        | MEDIUM       | S      |
| 7   | `:33`     | `item.link ?? ""` allows empty-URL stories through map                                                                                                   | LOW          | XS     |
| 8   | `:41`     | `new Date().toISOString()` pubDate fallback distorts descending sort                                                                                     | LOW          | XS     |

#### Vendor-PR filter — Raymond's spec for landing spot

**Where:** Inside `fetchRss` (`ingest-rss.ts:33`), at end of `.map(...)`, chain `.filter(vendorPRGate)`. **NOT** at fetch time, **NOT** in dedup.ts (Stage 3 boundary).

```ts
// scripts/pipeline/filters/vendor-pr.ts (NEW FILE)
const VENDOR_PR_TITLE =
  /^[A-Z][\w.&\- ]+ (Announces|Launches|Unveils|Introduces|Releases|Expands|Partners|Achieves|Joins|Names|Appoints|Acquires|Wins|Recognized|Earns|Celebrates|Welcomes)\b/i;
const PR_BODY =
  /webinar|whitepaper|register now|download the report|press release/i;
const CVE = /CVE-\d{4}-\d{4,7}/;

export function classifyVendorPR(s: Story): { drop: boolean; reason?: string } {
  if (VENDOR_PR_TITLE.test(s.title))
    return { drop: true, reason: "vendor-pr-title" };
  if (PR_BODY.test(s.excerpt) && !CVE.test(`${s.title} ${s.excerpt}`))
    return { drop: true, reason: "pr-body-no-cve" };
  return { drop: false };
}
```

**Tunable log line for false-positive review:**

```
[ingest][vendor-pr-drop] reason=vendor-pr-title source=darkreading title="Acme Announces Quantum-Safe Vault" url=...
```

**IMPORTANT — vulns-without-CVE holding-queue rule belongs to Stage 4 (engine), NOT Stage 2.** It needs `targetCategory` which `ingest-rss.ts` doesn't decide. Defer.

#### Story[] schema additions (additive, no breaking change)

```ts
// dedup.ts:21 (additive)
export type Story = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  sourceName: string;
  publishedAt: string;
  tags: string[];
  // NEW (all optional)
  sourceId?: string; // FeedSource.id — stable key for weighting
  sourceCategory?: string; // FeedSource.category — informs targetCategory
  fetchedAt?: string; // ISO timestamp
  qualityScore?: number; // copied from FeedSource at fetch time
  isVendor?: boolean; // pre-classified vendor-PR signal
};
```

Zod refinement option (dev-mode only — production stays on TS types):

```ts
if (process.env.NODE_ENV !== "production") StorySchema.array().parse(items);
```

`qualityScore` lives on `FeedSource` (`data/rss-sources.json`). Default 1.0 if absent. **Does NOT change selection in Stage 2** — only carries forward so Stage 4 (engine selection) can use it. **Avoids volume-rate perturbation during canonicalization recovery.**

#### Feed health observability — `data/feed-health.json`

```json
{
  "krebs": { "lastSuccess": "...", "consecutiveFailures": 0, "recent": [...] },
  "darkreading": { "lastSuccess": "...", "consecutiveFailures": 7, ... }
}
```

- **Write site:** `ingestFeeds` after `Promise.allSettled` (single batched write, mtime-keyed)
- **Sam's digest reads:** `consecutiveFailures >= 3` → red flag; `lastSuccess > 24h` → yellow
- **Bonus future:** auto-disable at `consecutiveFailures >= 10` (Stage 4 concern — flag, don't act, in Stage 2)

#### Volume-rate safety mitigation (KEY)

All 8 changes are additive or non-volume-affecting with ONE exception: vendor-PR filter mechanically reduces raw stories. Mitigation:

> **Log-only mode for first 7 days** with `VENDOR_PR_ENFORCE=false` env flag. Classify + log, don't drop. Measure false-positive rate against publish volume before flipping drop switch.

#### Scope guard — DO NOT TOUCH in this stage

- `Story.id` format (`:34`, `:65`) — `cache.ts:hashUrl` keys off it
- `deduplicate()` signature & semantics (`dedup.ts:143`) — Stage 3 boundary
- `isProcessed()` integration at `:114` — wasteful but Stage 3 fix (S2 = performance not correctness)
- `maxStories = 20` cap & final `.slice(0, maxStories)` — volume-rate sensitive during recovery
- `PUBLISHED_LOOKBACK_DAYS` filter (`:120-149`) — Stage 3 owns
- Sort order at `:104` (desc by publishedAt) — `deduplicate` keeps first occurrence; sort = source-authority ranking. Changing silently re-ranks. Leave.

#### Recommended actions (sequenced for implementation)

- **A2.1.** Wall-clock timeout (`Promise.race`) — ship today, XS, CRITICAL
- **A2.2.** Story schema additive extensions — ship today, XS, enables A2.3 + Stage 4
- **A2.3.** Vendor-PR filter (LOG-ONLY mode) — ship this week with `VENDOR_PR_ENFORCE=false`
- **A2.4.** Feed health JSON + Sam digest integration — Stage 8 will pick up the digest side
- **A2.5.** Per-source `maxItems` — ship after A2.3 stabilizes
- **A2.6.** After 7 days of log-only data, flip `VENDOR_PR_ENFORCE=true` if FP rate <2%

### Stage 3 — dedup.ts + cache.ts

- **Auditor:** Raymond
- **Status:** ✅ done 2026-04-22

| #   | Issue                                                                                                             | File:Line              | Sev      | Effort |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- | -------- | ------ |
| 1   | Non-atomic `writeFileSync` under p-limit(3) → torn JSON → silent reset of processed set → re-ingest weeks of URLs | `cache.ts:25-28`       | **CRIT** | XS     |
| 2   | `isProcessed()` reloads + re-parses JSON on every call (1k+ keys, 50× per ingest)                                 | `cache.ts:12-23`       | HIGH     | S      |
| 3   | Silent `catch {}` on MDX parse failure → broken file drops from dedup → duplicate ships                           | `dedup.ts:290`         | HIGH     | XS     |
| 4   | `markProcessedBatch` called per-article from p-limit → N writes per run (should batch + flush at end)             | `cache.ts:44-48`       | HIGH     | S      |
| 5   | `SIMILARITY_THRESHOLD = 0.50` deletes cross-source consensus (Vincent's signal)                                   | `dedup.ts:32, 143-161` | HIGH     | M      |
| 6   | `deduplicate()` "first occurrence wins" sort-order driven, ignores `qualityScore`                                 | `dedup.ts:147-158`     | MED      | S      |
| 7   | `loadAllPublished` only scans `content/en/` — silent dedup gap if ZH-native ingest added                          | `dedup.ts:233-238`     | MED      | S      |
| 8   | `loadAllPublished` unbounded scan from `findDuplicateOnDisk` — flagged but mtime memo makes it safe               | `dedup.ts:237`         | LOW      | none   |

#### Atomic cache write — exact pattern

```ts
function saveProcessed(set: Set<string>) {
  ensureCacheDir();
  const tmp = PROCESSED_FILE + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify([...set], null, 2));
  fs.renameSync(tmp, PROCESSED_FILE); // atomic on POSIX, near-atomic on NTFS
}
```

**`rename` is sufficient — DON'T add `proper-lockfile`.** Pipeline = single Node process with p-limit(3); real race is in-memory Set being read/mutated/serialized by 3 fibers. Fix with load-once Set + single writer + atomic rename together. `proper-lockfile` only matters for multi-process which we don't have (GHA cron-locked).

**Combined with #4 batch flush:** ONE rename per pipeline run from `pipeline/index.ts` top-level `try/finally` + signal handlers (`SIGTERM`, `SIGINT`, `beforeExit`).

#### Cross-source consensus — ship as separate function

```ts
export type StoryWithSignals = Story & {
  consensusScore: number; // 1 = single-source, 2+ = multi-source corroboration
  consensusSources: string[];
};

export function detectConsensus(
  stories: Story[],
  windowHours = 12,
  consensusThreshold = 0.4,
): StoryWithSignals[] {
  /* group by similarity+window, count distinct sourceName */
}
```

Pipeline order: `ingest → detectConsensus → deduplicate(keepHighestConsensus) → engine`. **Do NOT collapse into `deduplicate`** — separating preserves Stage 2's contract (`deduplicate(Story[]) → Story[]` order-preserving on single-source set), and lets Stage 4 (engine) read `consensusScore` for priority bumping.

**Defer activation 1-2 weeks behind `ENABLE_CONSENSUS_BOOST=false` env flag** — operator in canonicalization recovery, volume-rate or topic-mix shift = Google notices = extends cliff.

#### Quality-weighted winner — conditional yes

Insertion at `dedup.ts:147` before loop:

```ts
const sorted = [...stories].sort((a, b) => {
  const qDiff = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
  if (qDiff !== 0) return qDiff;
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
});
```

Changes ~10-20% of dedup decisions. **Ship behind `DEDUP_QUALITY_WEIGHTED=false`, flip after GSC ≥800 imp/day × 3 consecutive days.**

#### Scope guard — DO NOT TOUCH

- `Story.url` field name (Stage 2 contract; `cache.ts:hashUrl` keys off it)
- `deduplicate(Story[]): Story[]` signature (Stage 2 calls it; new consensus = sibling function, not changed return type)
- `isProcessed(url: string): boolean` sync signature (Stage 2 calls synchronously in `.filter()`; load-once Set makes it O(1))
- `hashUrl` algorithm + 16-char truncation (`cache.ts:30-32`) — changing invalidates entire on-disk cache → mass re-ingest. **NEVER change.**
- `PUBLISHED_LOOKBACK_DAYS = 30` — operator-tuned 2026-04-14. Don't lower during recovery.
- mtime memo invalidation key (`dedup.ts:203-213`) — must stay conceptually-aligned with `lib/content.ts` for dev intuition

#### Recommended actions (sequenced)

- **A3.1.** Atomic cache write (`tmp + rename`) — ship today, XS, CRIT
- **A3.2.** Loud warn on dedup parse failure — ship today, XS, HIGH
- **A3.3.** Load-once Set + batched flush + signal handlers — ship this week, S, HIGH
- **A3.4.** `detectConsensus()` sibling function (behind `ENABLE_CONSENSUS_BOOST=false`) — ship this week
- **A3.5.** Quality-weighted dedup (behind `DEDUP_QUALITY_WEIGHTED=false`) — ship this week
- **A3.6.** Flip env flags after GSC recovery confirmed

### Stage 4 — ENGINE (generation layer)

- **Status:** ✅ AUDITED EARLIER TODAY (separate session)
- **Findings synthesized into:**
  - `feedback_check_placement_not_existence.md` (4-occurrence reinforcement)
  - `feedback_cf_cache_deploy_race.md`
  - `feedback_vendor_install_drift.md`
  - `session_log_2026_04_21_cve_gate_plausible.md`
  - `postmortem_gsc_impression_cliff_2026_04_21.md`
  - `postmortem_plausible_vendor_drift_2026_04_21.md`
- **Open Tier 1 items still pending implementation:**
  - T1.3 Extract `lib/pipeline-gates.ts` (Vincent's ADR-0003)
  - T1.4 Category coercion in post-process when infoTokens=0
  - T1.5 Stateful regex bug fix in post-process.ts:276
  - T1 inline shipped (admin synth prompt + Zod schema + classifier + fact-check hedging gate + article.ts prompt rewrite — all uncommitted awaiting team review per Alex's tracker)

### Stage 5 — write-mdx + git commit/push + revalidate

- **Auditor:** Raymond
- **Status:** ✅ done 2026-04-22

| #     | Issue                                                                                                                                                                | File:Line                                                           | Sev      | Effort |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------- | ------ |
| **8** | **🔴 LIVE BUG: Discord URLs are 404 — `notify-discord` reconstructs from raw `article.slug` (`foo`), but disk path is `${date}-${article.slug}` (`2026-04-22-foo`)** | `notify-discord.ts:47-55,78`; `pipeline/index.ts:361,371`           | **CRIT** | XS     |
| 1     | Fire-and-forget CF purge — saves 5s × N articles serial                                                                                                              | `revalidate/route.ts:81`                                            | HIGH     | XS     |
| 2/F1  | Reorder commit BEFORE Discord — but git commit lives in GHA workflow not Node script. Real fix: write `discord-queue.json` from Node, flush in workflow post-push    | `pipeline/index.ts:332,361-377` + `ai-content-pipeline.yml:182-190` | **CRIT** | M      |
| 3     | Atomic `.tmp + rename` write (Vincent T3.2)                                                                                                                          | `write-mdx.ts:171`                                                  | HIGH     | S      |
| 4/F3  | Explicit partial-success — return HTTP 207 if CF purge failed; current 200 silently masks CF outages                                                                 | `revalidate/route.ts:82-88`                                         | HIGH     | XS     |
| 5     | Batched revalidate (`?paths=a,b,c` + CF accepts 30 URLs/call) — cuts 25s → 5s for 5-article batch                                                                    | `route.ts:37-63,116`                                                | MED      | S      |
| 6/F2  | Translation gate logs which sub-rule fired (3 conditions currently collapsed into 1 warning)                                                                         | `pipeline/index.ts:298-304`                                         | MED      | XS     |
| 7     | ZH-fail policy: leave EN, emit `locale_pair: undefined` correctly (already does) + add counter to digest                                                             | `write-mdx.ts:235`, `pipeline/index.ts:302`                         | LOW      | XS     |

#### KEY INSIGHT — finding #8 PROVES the contract-mismatch theory

`writeArticlePair` builds `datedSlug = "${date}-${article.slug}"` (line 200 — disk filename) but `notifyDiscord(article, ...)` is called with the raw `article` object whose `.slug` has no date prefix. `articleUrl()` at `notify-discord.ts:78` produces `/en/articles/foo` instead of `/en/articles/2026-04-22-foo` → **404 on every Discord post**, every day, since Discord wiring shipped.

Two adjacent stages, two mental models of "the article URL," no contract enforcing they match. **This is exactly the operator's diagnostic.**

#### Recommended actions

- **A5.0 DOWNGRADED 2026-04-22** — Discord webhook env vars not configured (`DISCORD_WEBHOOK_EN/ZH` unset), so the broken URL bug is LATENT not LIVE — no customer impact. Fix bundled into contract-refactor work, not same-day. Operator's strategic call: don't enable Discord channel publicly until engine is fixed.
- **A5.1.** Fire-and-forget CF purge — XS, ship today
- **A5.2.** Atomic write pattern in write-mdx.ts — S, ship this week
- **A5.3.** Discord queue + workflow flush (F1 fix) — M, this week
- **A5.4.** Revalidate HTTP 207 partial-success — XS, ship today
- **A5.5.** Translation gate sub-rule logging — XS, ship today
- **A5.6.** Batched revalidate — defer; A5.1 (fire-and-forget) makes this nice-to-have not critical

### Stages 6-9 — CANCELLED 2026-04-22

**Reason:** Operator pivoted to contract-first design (Option A) after Stage 5's #8 finding (live Discord URL bug) confirmed the diagnostic that the chain is built without inter-stage contracts. Each stage works locally; boundaries are broken.

Continuing 6-9 would surface more contract failures of the same class — diminishing returns vs the value of designing the unified contract first. Stages 6-9 will be **compliance-audited** AFTER the contracts exist, instead of independently audited.

| Stage                          | Original auditor | Status       | Will be addressed via                                                         |
| ------------------------------ | ---------------- | ------------ | ----------------------------------------------------------------------------- |
| 6. Render layer                | Vincent          | ⛔ cancelled | Vincent's contract design will define what render layer must consume          |
| 7. Sitemap + robots + RSS feed | Maya             | ⛔ cancelled | Discovery contract will define output shape; Maya does compliance audit later |
| 8. Discord + email digest      | Sam              | ⛔ cancelled | Distribution contract will be defined; Stage 5 #8 bug fixed inline            |
| 9. GSC + Plausible + KPIs      | Eric             | ⛔ cancelled | Feedback-loop contract design (Vincent's recommendation) supersedes           |

---

## Phase A — Contract spec DELIVERED 2026-04-22

**Vincent's contract design landed.** Full spec at `docs/pipeline-contracts-2026-04-22.md`.

Headline structure:

- 3 core schemas (`SourceMetadata`, `Story`, `PipelineContext`) in new `scripts/contracts/schemas.ts`
- 11-row inter-stage contract table (every adjacent pair: producer MUST emit / consumer MAY use / MUST validate / failure mode)
- 3 feedback loops (GSC→qualityScore, Plausible CTR→title patterns, Resend opens→subject patterns)
- 11-step rollout sequence with backward-compat + volume-rate safety baked in
- 10-item compliance checklist for Phase B (Raymond runs after spec approval)
- 7 open questions for operator + Eric **[blocking implementation]**

**Key invariant Vincent introduced:** _every URL/slug computation routes through ONE module `lib/article-url.ts`_. Greppable convention. Fixes the Stage 5 #8 latent Discord URL bug structurally — not as a one-off patch but as a system rule. No more "two stages, two URL constructions."

**Awaiting:** operator + Eric answers to the 7 open questions before Raymond can start Phase B.

## Pivot — 2026-04-22

**Decision:** Operator chose Option A (pivot now) after Stage 5 confirmed contract-mismatch is the root cause of quality issues. Bottom-up audits surfaced enough evidence; further bottom-up has diminishing returns.

**New methodology:**

1. **Phase A — Contract-first design** (Vincent leads):
   - Canonical `Story` schema (Zod) with required vs optional fields
   - `SourceMetadata` schema (qualityScore, region, language, type, lastSuccess)
   - `PipelineContext` schema (run ID, classifier output, consensus signals)
   - Inter-stage contracts: "Stage N MUST produce {X,Y,Z}; Stage N+1 MAY consume {X,Y}, MUST consume {Z}"
   - **Top-down feedback contracts** (Stage 9 backward through chain — what does Google/reader/sub conversion NEED?)
2. **Phase B — Compliance audit** — for each existing stage, list violations against new contract
3. **Phase C — Refactor sequencing** ordered by blast radius, volume-rate safety, operator hour cost, strategic value
4. **Phase D — Implement, ship behind flags, measure, iterate**

**Concurrent track — Stage 5 inline fixes** ship in parallel:

- A5.0 Discord URL hotfix (same day — live customer-facing bug)
- A5.1, A5.4, A5.5 (XS effort fixes that don't conflict with contract refactor)

### Stage 6 — Render layer (slug page + JSON-LD + ISR)

- **Auditor:** Vincent (architecture-focused — render-time invariants)
- **Status:** ⏸ queued
- **Pre-known issues:**
  - S7 (Raymond): `JsonLd.tsx:38-43` redundant `dateModified ?? datePublished` evaluations (low-sev code smell)
  - Vincent: hreflang asymmetry (when `locale_pair` missing, page links to itself = Google ignores both)
- **Findings:** _(to be filled)_

### Stage 7 — Discovery layer (sitemap + robots + RSS feed)

- **Auditor:** Maya (SEO impact lens)
- **Status:** ⏸ queued
- **Pre-known issues:**
  - 🟠 S4 (Raymond): `sitemap.ts:131-151` is O(tags × posts × 2) un-memoized — slow regen, near-Googlebot-timeout
  - S9 (Raymond): hreflang fallback when `locale_pair` missing → self-referential broken link in sitemap
  - Vincent: sitemap entries pointing to deleted articles (cache holds 404s; Google deprioritizes)
- **Findings:** _(to be filled)_

### Stage 8 — Distribution (Discord + email digest)

- **Auditor:** Sam (ops oversight)
- **Status:** ⏸ queued
- **Pre-known issues:**
  - S8 (Raymond): Discord webhook fetch has no timeout (can hang indefinitely under rate-limit)
  - Vincent: Discord silent failure for revoked webhook (community drops, no alarm)
  - Vincent: send-digest.ts what happens on Resend rate-limit? (article committed but readers don't get digest = silent loss)
- **Findings:** _(to be filled)_

### Stage 9 — Feedback (GSC + Plausible + KPIs)

- **Auditor:** Eric (strategic — feedback loop integrity)
- **Status:** ⏸ queued
- **Pre-known issues:**
  - Vincent: GSC indexing data → source quality score (highest-leverage loop to close; system-wide self-tuning)
  - Plausible just installed today (no historical data yet; baseline 7 days out)
  - Newsletter subs at 0 (kill criterion is 300 by 2026-10-20)
- **Findings:** _(to be filled)_

---

## Pass 2 — Top-down audit (Stage 9 → Stage 1, contract integrity)

### Goal: Reader trust → newsletter sub → sponsor → revenue

- **What does Stage 9 (feedback) NEED from Stage 8 (distribution)?**
- **What does Stage 8 NEED from Stage 7 (discovery)?**
- **... continue back to Stage 1**
- **Where do producer/consumer contracts mismatch?**

_(Filled after Pass 1 complete)_

---

## Cross-stage gaps (synthesized from both passes)

_(Filled after Pass 2)_

---

## Action priority matrix

| ID                       | Stage | Severity | Effort | Owner | Reviewer | Status |
| ------------------------ | ----- | -------- | ------ | ----- | -------- | ------ |
| _(filled progressively)_ |       |          |        |       |          |        |

---

## Definition of "done" for the chain

_(Drafted after Pass 1, refined after Pass 2)_

---

## Iteration log

- **Pass 1 start:** 2026-04-21 evening
- **Pass 1 complete:** _(pending)_
- **Pass 2 start:** _(pending)_
- **Pass 2 complete:** _(pending)_
- **First implement cycle:** _(pending)_
- **Repeat:** _(pending)_
