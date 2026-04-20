# Tag SEO — Intros + Thin-Tag Hiding Tracker

**Status**: Draft — P1 queued for same-day ship
**Author**: Alex (PM)
**Last updated**: 2026-04-20
**Operator approval**: Eric-level given (in-conversation)
**Related**:

- `docs/pipeline-enrichment-tracker.md` (shift-right pattern we're reusing)
- `~/.claude/projects/…/memory/seo_baseline_2026_04_18.md` (GSC baseline)
- `feedback_flex_item_min_width.md` (mobile gate)

---

## 1. Problem & evidence

Google Search Console (2026-04-18 snapshot): **128 pages "Crawled — currently not indexed"**. Investigation points to tag pages as primary offender:

1. **Thin tags** (<5 articles) — 1–2 article pages look like doorway pages to Google. Helpful Content signal: low unique value.
2. **Mid-depth tags** (≥5 articles) — render only article grids with zero editorial context above the fold. Google shelves them as "crawled, not indexed" because there is no unique-value content on the URL.

Baseline to capture before ship (Test Automator, P1 prereq):

- Count of tags with <5 articles per locale
- Count of tags with ≥5 articles per locale
- Current GSC "crawled not indexed" count (reference: 128 on 2026-04-18)

---

## 2. Decision + scope

**In scope**:

- P1 — Hide thin tags (<5 articles) from sitemap + internal linking
- P2 — Script that aggregates structured facts per tag from MDX frontmatter
- P3 — LLM phrases facts into 80–120 word intro (EN)
- P4 — ZH translation via Kimi
- P5 — Tag page renders intro; ISR revalidate on commit
- P6 — Fact-check guard (regex cross-validation, reject+retry ×2)
- P7 — GHA scheduled regen job (content-hash cache, only regen when membership changes)

**Out of scope (this tracker)**:

- Full tag-page redesign (separate initiative, Q3 candidate)
- Category page intros (follow-up once tag pattern proven)
- LLM-written generic blurbs with no fact sheet (rejected — Helpful Content risk)
- Homepage / category index changes

**Rejected**: pure-LLM general-knowledge blurbs. All prose must be grounded in aggregated frontmatter facts. This is non-negotiable per operator memory: _"LLM writes prose, script extracts structured data."_

---

## 3. Architecture

### Data pipeline

```
MDX frontmatter
  ↓ (script, deterministic)
data/tag-facts/{locale}/{tag}.json   ← structured fact sheet per tag
  ↓ (LLM via lib/ai-provider.ts — Kimi default, free-first fallback)
data/tag-intros/en/{tag}.json        ← { intro, sources_hash, model, generated_at }
  ↓ (Kimi translate)
data/tag-intros/zh/{tag}.json
  ↓ (commit to Git, revalidatePath)
Tag page renders intro above grid
```

### Fact sheet shape (per tag, per locale)

```json
{
  "tag": "ransomware",
  "locale": "en",
  "count": 23,
  "date_range": { "first": "2026-03-12", "latest": "2026-04-19" },
  "top_actors": ["LockBit 4.0", "BlackCat", "Cl0p"],
  "top_cves": [{ "id": "CVE-2026-34621", "cvss": 9.8 }],
  "top_sectors": ["healthcare", "finance"],
  "top_regions": ["North America", "Europe"],
  "severity_mix": { "critical": 8, "high": 11, "medium": 4 },
  "recent_excerpts": ["…", "…", "…"],
  "sources_hash": "sha256(sorted_slugs + latest_mtime)"
}
```

### Cache key (incremental regen)

`sources_hash = sha256(JSON.stringify({slugs: sortedTaggedSlugs, mtime: maxMtime}))`
If the stored intro's `sources_hash` matches, skip regen. Only regen on membership or content change.

### Storage

`data/tag-intros/{locale}/{tag}.json` — Git-as-CMS, consistent with site's content model. One file per tag per locale. Committed.

### Render-time

`lib/tag-intros.ts` (new) — `getTagIntro(tag, locale)` reads JSON (memoized mtime-keyed map, mirror `lib/content.ts` pattern). Tag page renders `<TagIntro />` above the article grid. Missing intro → no render (graceful).

---

## 4. Phased delivery

### P1 — Hide thin tags (SAME-DAY, autonomous) 🟢 queued

- `lib/content.ts`: keep `getAllTags()` returning all tags (admin/search still need them)
- New helper `getPublicTags(locale)` — filters `count >= 5`
- `app/sitemap.ts`: use `getPublicTags`
- Any footer / homepage / in-article tag clouds: use `getPublicTags`
- `app/[locale]/tags/[tag]/page.tsx`: keep rendering, but emit `<meta name="robots" content="noindex,follow">` when `count < 5` (belt-and-braces — prevents accidental indexation via backlinks)
- Tag chip **inside article cards** continues to render (UX need), but links for thin tags get `rel="nofollow"`

**Acceptance**:

- [ ] Sitemap regen drops all <5-article tag URLs
- [ ] Curl a thin tag page → `robots: noindex,follow` header + meta present
- [ ] No regression in admin `/admin/articles` tag filter UI
- [ ] Playwright: article page still shows tag chip, no layout break mobile 375px
- [ ] Publish → revalidate → sitemap reflects change within 60s

**Rollback**: revert single commit; thin tags return to sitemap.

**Owner**: Raymond. **Review**: Alex. **Operator sign-off**: not required (autonomous — reverts cleanly).

---

### P2 — Aggregation script (Day 1–2) 🟡

- `scripts/tag-intros/aggregate-facts.ts` — reads all MDX via existing `getAllPosts`, groups by tag per locale, writes `data/tag-facts/{locale}/{tag}.json`
- Deterministic sort + dedup. Top-N cut-offs as per fact sheet shape.
- Idempotent. Safe to re-run.

**Acceptance**:

- [ ] Running script on current corpus produces one JSON per tag with ≥5 articles
- [ ] `sources_hash` stable across two consecutive runs
- [ ] Zero network calls (pure local MDX scan)
- [ ] Unit smoke: `scripts/smoke-test-tag-facts.ts` validates shape + expected tag count

**Owner**: Raymond. **Operator sign-off**: not required.

---

### P3 — LLM phrasing (Day 2) 🟡

- `scripts/tag-intros/phrase-intro.ts` — consumes fact sheet, calls `generateWithFallback('kimi')`
- System prompt: strict "use ONLY provided facts" rules (see §5). Prompt Engineer owns.
- Writes `data/tag-intros/en/{tag}.json` with `{ intro, sources_hash, model, generated_at }`

**Acceptance**:

- [ ] 80–120 word output (validation by word count)
- [ ] Zero CVE IDs or threat actor names in output that aren't in the fact sheet (pre-fact-check sanity)
- [ ] Cost < $0.005/tag (target Kimi $0.001)

**Owner**: Raymond (code) + Prompt Engineer (prompt). **Operator sign-off**: review sample of 5 intros before bulk run.

---

### P4 — ZH translation (Day 2) 🟡

- Reuse `translateWithFallback()` (Kimi primary per operator pref for ZH)
- Writes `data/tag-intros/zh/{tag}.json`
- Translation preserves all CVE IDs + actor names verbatim (no localization of those tokens)

**Acceptance**:

- [ ] ZH output exists for every EN intro generated
- [ ] CVE IDs present in EN appear byte-identical in ZH
- [ ] Actor names transliterated OR kept in English per existing article convention (check current ZH corpus)

**Owner**: Raymond + Prompt Engineer. **Operator sign-off**: spot-check 3 ZH intros.

---

### P5 — Render + revalidate wiring (Day 2–3) 🟡

- `lib/tag-intros.ts` — mtime-keyed memo reader
- `components/tags/TagIntro.tsx` — Ken designs per `docs/design-standard-2026.md`. Small block: heading + 80–120 word prose + optional "based on N articles since {date}" meta line.
- `app/[locale]/tags/[tag]/page.tsx` — renders `<TagIntro />` above grid
- After aggregation or regen script commits, fire `revalidatePath('/{locale}/tags/{tag}')` and `revalidateTag('tags', 'max')`

**Acceptance**:

- [ ] Tag page shows intro above grid on both locales
- [ ] Lighthouse mobile LCP ≤ 2.5s (per 2026 mobile standard)
- [ ] Playwright 320/375/414/768 viewports: no horizontal scroll, intro block `min-w-0` compliant
- [ ] RSC cache test: hard refresh 3× → consistent render (no cache poisoning)
- [ ] ISR: commit new tag intro → live on VPS within 10s (content-only deploy path)

**Owner**: Raymond + Ken (component). **Operator sign-off**: visual approval of first rendered tag page.

---

### P6 — Fact-check guard (Day 3) 🟡 **blocking for bulk run**

- `scripts/tag-intros/fact-check.ts` — regex extracts CVE IDs + actor names + counts from LLM output; cross-validates against fact sheet
- Reject + retry max 2× with "stay grounded in provided facts" reminder
- On 3rd failure: skip tag, log to `data/tag-intros/_rejected.json` for human review
- Mirrors `scripts/pipeline/fact-check.ts` pattern exactly

**Acceptance**:

- [ ] Injection test: craft a fact sheet missing CVE-2026-99999, LLM prompt nudged to invent → fact-check catches it → retry succeeds OR rejects cleanly
- [ ] Known-good fact sheet → 0 false rejections across 10 tags
- [ ] Rejected-intros log file created + persisted

**Owner**: Raymond + Prompt Engineer. **Operator sign-off**: required before bulk run (we do not want hallucinated CVEs in committed content).

---

### P7 — GHA scheduled regen (Day 3–4) 🟢

- `.github/workflows/tag-intros-refresh.yml` — daily 03:00 SGT (off-peak)
- Runs aggregation → diffs `sources_hash` per tag → only regenerates changed tags
- Commits to `main` via existing Git Data API pattern (single atomic commit for all changed tags)
- Content-only deploy path picks it up, revalidates, done
- Manual trigger: `workflow_dispatch` with `force_all: bool` flag

**Acceptance**:

- [ ] Scheduled run on unchanged corpus → 0 commits, exit 0
- [ ] Scheduled run after a new article lands with existing tag → exactly 1 tag regenerated, exactly 1 commit
- [ ] Total runtime < 5 min on typical daily delta
- [ ] Cost monitoring: daily Kimi spend logged in run output
- [ ] CF Bot Fight retry-on-403 included per `feedback_gh_actions_cf_bot_fight.md`

**Owner**: Raymond + Harness Engineer (workflow). **Operator sign-off**: review first scheduled run.

---

## 5. LLM prompt constraints (frame for Prompt Engineer)

**System prompt must enforce:**

1. Use ONLY facts provided in the fact sheet. No general knowledge.
2. Do NOT invent CVE IDs, actor names, sector names, or counts not in the sheet.
3. Lead with concrete count + date range (e.g., "Across 23 reports since March 12…").
4. Name specific actors and CVEs when present.
5. Avoid adjectives/superlatives not supported by the data ("massive", "devastating", "unprecedented").
6. 80–120 words. Third person. No CTAs, no "read more", no "stay tuned".
7. No "emerging threats" / "growing concern" / generic filler phrases.

**Footprint avoidance**: Kimi has some inherent variation; add 3 rotating phrasing hints to system prompt (lead with count / lead with date range / lead with top actor) to avoid template detection.

Prompt Engineer delivers: `scripts/ai/prompts/tag-intro.ts` + `tag-intro-translate.ts`.

---

## 6. Dependencies

- [x] `KIMI_API_KEY` — already in VPS `.env.local`
- [x] `OPENROUTER_API_KEY` — already present (free-first fallback)
- [x] `GITHUB_TOKEN` for atomic commits — already present
- [x] `REVALIDATE_SECRET` — already present
- [ ] No new secrets required
- [x] Existing pipeline infra: `lib/ai-provider.ts`, `scripts/pipeline/fact-check.ts` (pattern), `lib/github-commit.ts`

---

## 7. Rollback plan

| Phase | Rollback                                                             |
| ----- | -------------------------------------------------------------------- |
| P1    | Revert commit; sitemap + nofollow revert                             |
| P2    | Delete `data/tag-facts/`; no user-facing effect                      |
| P3–P4 | Delete `data/tag-intros/{locale}/`; component gracefully omits intro |
| P5    | Feature-flag `TagIntro` via env `TAG_INTROS_ENABLED`; flip off       |
| P6    | Fact-check failure on bulk → kill run, no partial commit             |
| P7    | Disable workflow schedule; run P2–P6 manually if needed              |

Every phase is independently revertible. No schema migrations, no DB changes.

---

## 8. KPIs

**Primary (4-week horizon)**:

- GSC "Crawled — currently not indexed" count: **128 → <60** (–53%)
- Tag pages indexed (GSC): baseline TBD P1, target +30 indexed
- Organic impressions on tag pages (GSC): +50% week-over-week by Week 3

**Guardrails**:

- Zero hallucinated CVE IDs in committed intros (fact-check enforced)
- Tag page mobile Lighthouse LCP ≤ 2.5s maintained
- Daily Kimi spend for tag intros < $0.50 (incremental regen caps this naturally)
- Zero regressions in `/admin/articles` tag filter UX

**Learning metric**: % of tag intros that get at least 1 click from GSC in first 4 weeks. Informs whether to extend to category pages.

---

## 9. Open questions

- [ ] Do we render a "based on N reports since {date}" meta line under the intro? (Ken call — leaning yes for transparency)
- [ ] Minimum count for intro generation — is 5 right, or should it be 8? (Will check corpus distribution in P2)
- [ ] Should intro regen trigger on tag-count delta only, or also on "new article with top-10 CVSS" even if tag membership unchanged? (Defer — likely premature optimization)

---

## 10. Ownership snapshot

| Phase | Primary               | Support        | Operator gate                 |
| ----- | --------------------- | -------------- | ----------------------------- |
| P1    | Raymond               | Alex review    | ❌ autonomous                 |
| P2    | Raymond               | —              | ❌                            |
| P3    | Raymond + Prompt Eng  | Alex           | ✅ sample 5 intros            |
| P4    | Raymond + Prompt Eng  | —              | ✅ spot-check 3 ZH            |
| P5    | Raymond + Ken         | Alex           | ✅ visual approval            |
| P6    | Raymond + Prompt Eng  | Test Automator | ✅ required before bulk run   |
| P7    | Raymond + Harness Eng | Alex           | ✅ review first scheduled run |

---

## 11. Status log

- **2026-04-20** — Tracker drafted, P1 queued. Awaiting Raymond pickup.
