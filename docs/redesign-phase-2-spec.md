# Redesign Phase 2 — Mobile Homepage Specification

**Status**: **LOCKED** — operator approved final design 2026-04-18
**Author**: Alex (PM) with Ken (Design) input, Vincent (Architect) notes, Raymond (Engineering) review, Maya (SEO) checklist
**Last updated**: 2026-04-18 (final)
**Deploy target**: Single-commit ship after gate review passes

---

## FINAL LOCKED DESIGN (supersedes any earlier draft sections below)

After iterating on ASCII wireframes A/B/C/D with the operator, the locked homepage architecture is:

### Region 1 — Mixed-category 3-column hero (Option A-revised)

Each column has a distinct VISUAL ROLE + distinct SELECTION RULE (not just recency):

| Column                       | Visual role                                                                                 | Selection rule                                                                                             | Fallback if no match                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **LEFT (text-forward lead)** | Category-colored left-border, NO photo, serif title, full excerpt, CTA link                 | **Highest-severity article from the last 24h**, prefer threat-intel category. Ties → recency.              | Most recent threat-intel                                                 |
| **CENTER (photo lead)**      | **THE ONE photo on the page**, serif title below photo, short excerpt, tag chips            | **Most recent article WITH a `featured_image` frontmatter field set**                                      | Most recent article overall; use `CATEGORY_DEFAULT_IMAGES[category]` SVG |
| **RIGHT (severity-forward)** | **Full-card severity-color tint** + thick left accent border, serif title, CVSS/impact meta | **Highest-severity vulnerability from the last 7 days** (CVSS ≥ 7.0 preferred — big score = visual weight) | Highest-severity threat-intel of any recency                             |

**Dedup**: if the same article would win 2 slots, it takes the highest-priority slot (LEFT > CENTER > RIGHT) and the loser falls through to its next candidate.

**Allowed duplication across page**: an article picked for hero MAY still appear in its per-category section below. Matches real-newspaper front-page-plus-section pattern (NYT, BBC, WSJ). One canonical URL, multiple surface spots.

### Region 2 — "More From Today" horizontal ticker strip

- Full-width, below hero
- 5 rows, time (relative) · category chip · title (truncated to 1 line)
- Sourced from: the next 5 most-recent articles **excluding** the 3 already in hero
- "See all →" link routes to `/[locale]/articles`

### Region 3 — Sticky category pills row

- Horizontal scroll on mobile, full row on desktop
- Pills: ALL · THREAT INTEL · VULNERABILITIES · MALWARE · INDUSTRY · TOOLS · AI
- "ALL" active when on homepage
- Pills route to `/[locale]/categories/[category]`
- Sticky (position: sticky + top: header height) once user scrolls past original position

### Region 4 — Per-category sections (NEW patterns per category)

| Category            | Pattern                                                                         | Visual hero per card                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Threat Intel**    | **Photo-forward** (2-col: lead with photo 60% / 2 typography cards stacked 40%) | Photo on lead; severity accent + serif title on supporting cards                                                             |
| **Tools**           | **Photo-forward** (same 2-col pattern)                                          | Product/tool screenshot on lead; supporting cards typography                                                                 |
| **Vulnerabilities** | **Typography-forward** (3-col equal)                                            | **Big CVSS score** (e.g. `9.8` in 72px Source Serif 4 black, colored by severity band)                                       |
| **Malware**         | **Typography-forward** (3-col equal)                                            | **Threat actor name** (e.g. `LockBit 4.0` in serif 700) + family tag chip (`RANSOMWARE`, `APT`, `RAT`)                       |
| **Industry**        | **Typography-forward** (3-col equal)                                            | **Entity/company name** (e.g. `McGraw-Hill`, `Google`, `UK ICO`) + angle chip from `tags[0]` uppercased                      |
| **AI**              | **Typography-forward** (3-col equal)                                            | **Provider or attack class** (e.g. `Anthropic`, `Prompt Injection`) + role chip (`PROVIDER`, `ATTACK VECTOR`, `MEMORY VULN`) |

Rationale: photo sections (threat-intel, tools) = concrete news/product. Typography sections = abstract/data (CVSS scores, threat-actor names, entity names, AI concepts). Mixing creates visual rhythm so scrolling feels curated, not templated.

### Region 5 — Existing Newsletter CTA (unchanged)

### Gap discipline

- Mobile: `gap-6` (24px) between cards
- Desktop: `gap-8` (32px) between cards
- Responsive via `gap-6 lg:gap-8`

### Category color tokens (new — add to `globals.css`)

| Category        | HSL (light theme)        | Used on                                                                       |
| --------------- | ------------------------ | ----------------------------------------------------------------------------- |
| threat-intel    | `0 74% 50%` red          | section-header accent bar, card left-border if severity absent, category chip |
| vulnerabilities | `25 85% 45%` orange      | same                                                                          |
| malware         | `280 65% 50%` purple     | same                                                                          |
| industry        | `210 70% 40%` blue       | same                                                                          |
| tools           | `160 60% 35%` teal-green | same                                                                          |
| ai              | `190 75% 45%` cyan       | same                                                                          |

Matched dark-theme variants in `.dark` block (slightly brighter for contrast on black).

### The ONE photo rule

The entire homepage above the fold shows **exactly ONE photo** — in the hero center column. All other cards rely on typography + color. Reasons:

- No "3 identical placeholder images" (current bug)
- Per-category default SVGs ship as OG images for social sharing only (never visible on-site)
- Typography cards load faster (no image bytes), better mobile LCP
- Photo becomes a deliberate editorial signal, not a template filler

---

## Original spec (historical — superseded by FINAL LOCKED DESIGN above)

The sections below were drafts from earlier iterations. They're preserved for audit trail but may contradict the locked design. When in conflict, **the FINAL LOCKED DESIGN section above wins**.

---

**Blocked on**: Phase 1 (`4d271c8`) observing stable for 3-5 days; operator green-lights Phase 2

---

## Why this exists

Phase 1 landed typography + theme flip. Phase 2 applies the TX3/Vertonews/NYT iPhone-mockup vibe to the **homepage hero region**, optimized mobile-first because XHS funnel pushes 60%+ mobile traffic to the domain. The goal: when a new visitor lands on `/en` or `/zh`, the first-paint experience feels like a real news publication with a clear "what's breaking today" hook — not a neutral feed of cards.

**Operator-approved decisions locked 2026-04-18:**

1. Homepage layout pattern = **"Above the Fold" (Option A)** — one lead story dominates, two secondary leads below, then a compact "MORE FROM TODAY" ticker strip, then existing category sections. Supersedes the earlier cycling-hero concept (operator reviewed ASCII wireframes for A/B/C/D, picked A).
2. Mobile is the primary design target (XHS funnel). Desktop layout derives from mobile, not the other way around.
3. Ship Phase 2 alone after Phase 1 observation window. Phases 3-4 remain deferred.

**Why Option A over cycling hero**:

- One stable lead story matches how news readers consume homepages — they want to know "what's THE story today," not watch a carousel rotate
- Cycling creates CLS risk + accessibility overhead; Option A has zero motion
- Pattern used by NYT / BBC / Bloomberg / The Verge / TechCrunch — familiar to readers
- Keeps the existing category sections below, so the rich IA we've built isn't thrown away

---

## Phase 2 scope (THIS COMMIT ONLY)

### What ships (revised 2026-04-18 — Option A layout locked)

| Change                                                                                                                                                            | Why                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Add mobile-first **Greeting strip** above hero                                                                                                                    | NYT mockup pattern: "APR 18, 2026 · What's breaking?" |
| Add compact **Search bar** (stub — opens existing `SearchDialog` modal)                                                                                           | Mockup pattern; zero new API work                     |
| Replace current **Breaking ticker** + **Latest section** with Option A's **LeadStoryHero** (huge serif lead + 2 secondary leads + "MORE FROM TODAY" ticker strip) | Operator picked Option A over cycling                 |
| Add **CategoryPillsRow** — horizontal scrollable category chips                                                                                                   | Mockup pattern; quick filter UX                       |
| Keep all existing **per-category sections** (threat-intel / vulnerabilities / malware / industry / tools / ai)                                                    | These stay for Phase 3 to redesign                    |
| Keep existing **Newsletter CTA** at bottom                                                                                                                        | Unchanged                                             |
| Keep existing **h1 sr-only** anchor                                                                                                                               | SEO critical — do NOT remove                          |
| Keep existing **HomeJsonLd**                                                                                                                                      | SEO critical — do NOT remove                          |

### What does NOT ship in Phase 2

- ❌ No per-category section redesign — that's Phase 3
- ❌ No article listing page redesign — Phase 3
- ❌ No article detail polish — Phase 4
- ❌ No new metadata / canonical / hreflang changes
- ❌ No new structured data types
- ❌ No new routes
- ❌ No sitemap/robots changes
- ❌ No changes to `/salary` (it has its own cinematic hero)
- ❌ No changes to proxy/i18n/cache config
- ❌ No full-page photo hero — we don't yet have article photos

---

## Design detail — mobile-first

### Vertical stack (top to bottom on mobile ≤640px)

```
┌─────────────────────────────────────────┐
│  1. Greeting strip (compact, 1 line)    │ ← ~48px tall
│     APR 18, 2026 · What's breaking?     │
├─────────────────────────────────────────┤
│  2. Search bar (tap → opens modal)      │ ← ~44px tall
│     🔍 Search articles...               │
├─────────────────────────────────────────┤
│  3. CyclingHero slot                    │ ← ~200px tall
│     ┌───────────────────────────────┐   │   (fixed height,
│     │                               │   │    no CLS during
│     │   [Slide 1 / 2 / 3 content]   │   │    cycle)
│     │                               │   │
│     │   ●  ○  ○                     │   │
│     └───────────────────────────────┘   │
├─────────────────────────────────────────┤
│  4. CategoryPillsRow (horiz scroll)     │ ← ~48px tall
│     ALL · THREAT INTEL · VULNS · ...    │
├─────────────────────────────────────────┤
│  5. Existing category sections          │
│     (LATEST, THREAT INTEL, VULNS, ...)  │
│     UNCHANGED — Phase 3 redesigns       │
├─────────────────────────────────────────┤
│  6. Newsletter CTA                      │
│     UNCHANGED                           │
└─────────────────────────────────────────┘
```

Total above-the-fold stack (items 1-3) ≈ **292px** on iPhone SE (320×568) — leaves room for category pills + first category section headline on first paint. Matches NYT mockup's first-viewport density.

### Desktop layout (≥1024px) — Option A 3-stage vertical

NOT a multi-column hero. Desktop preserves Option A's signature "one story owns the fold" pattern:

```
Stage 1 (full-width):  [     THE LEAD     ]            ~320-400px tall
Stage 2 (2-col):       [ secondary 1 ][ secondary 2 ]  ~240px tall
Stage 3 (full-width):  [  MORE FROM TODAY ticker  ]    ~280px tall
                       [  pills row  ]                  ~48px, sticky
                       [  per-category sections  ]     unchanged from current
```

Desktop-specific tweaks:

- Greeting + Search sit **side-by-side** in a single row (~56px tall)
- THE LEAD headline scales up to 40-56px (Source Serif 4 700). Excerpt up to 3 lines.
- Secondary leads become 2-col side-by-side (mobile stacks them)
- Ticker strip shows 5-7 rows full-width (mobile shows 5 in a narrower stack)

Rationale for NOT splitting the lead + ticker into 2 columns:

- Option A's signature is the big-lead-dominates-the-fold pattern
- Side-by-side lead + ticker = Option B, not A (operator rejected B)
- Desktop visitors scroll too — ticker below lead feels natural, not wasteful

Phase 3 will tackle desktop-specific richness for per-category sections if needed after observing Phase 2.

### 3 hero slide designs

#### Slide 1 — Lede quote

**Data source**: the LATEST article across posts + threat-intel (same source as current `breaking` ticker uses).

**Content pattern**: pull one of three fields from the latest article's frontmatter:

- `shocking_fact` if present (preferred — already punchy)
- `excerpt` truncated to ~80 chars (fallback)
- Headline (last resort)

**Visual**:

```
┌───────────────────────────────┐
│  LEDE                         │ ← 10px eyebrow
│                               │
│  "13.5M records exposed in    │ ← Source Serif 4, 24px bold
│   McGraw-Hill breach"         │   (editorial feel)
│                               │
│  2h ago · Threat Intel        │ ← 11px muted
│                               │
│                     Read →    │ ← 14px CTA
└───────────────────────────────┘
```

Background: solid `bg-card` with thin `border-border`. No photo — that's the whole point of this slide.

#### Slide 2 — Breaking news ticker

**Data source**: 3 most recent articles across posts + threat-intel.

**Visual**:

```
┌───────────────────────────────┐
│  🔴 BREAKING                  │ ← destructive red pill
│                               │
│  1h  ChipSoft breach...       │ ← compact rows, mono
│  3h  Microsoft blocks RDP...  │   time + title
│  5h  REF6598 phishes crypto.. │
│                               │
│                  See all →    │
└───────────────────────────────┘
```

Rows are tappable and route to the respective article. Mono font for timestamps (tabular alignment), Inter for titles (truncated to 1 line each with `line-clamp-1`).

#### Slide 3 — Featured threat card

**Data source**: highest-`severity` threat-intel article in the last 7 days. Severity order: critical > high > medium > low > informational.

**Visual**:

```
┌───────────────────────────────┐
│  ┃ CRITICAL                   │ ← left-border in severity color
│  ┃                            │
│  ┃ LockBit 4.0 Targets        │ ← Source Serif 4, 20px bold
│  ┃ Healthcare Sector          │
│  ┃                            │
│  ┃ CVSS 9.8 · 4 CVEs          │ ← mono, tabular
│  ┃ Affected: North America    │
│  ┃                            │
│  ┃                   View →   │
└───────────────────────────────┘
```

The severity color (red for critical, orange for high, etc.) drives the left-border accent — already tokenized in `globals.css` as `--severity-critical/high/medium/low/info`.

If there's NO threat-intel in the last 7 days: fall back to showing whatever the latest TI article is, regardless of severity. If there's NO TI content at all: skip this slide (cycle only between slides 1-2).

### Cycling mechanics

| Parameter                     | Value                                                                    | Rationale                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Rotation interval             | **10 seconds per slide**                                                 | Long enough to read a slide's content; short enough to discover the others |
| Transition effect             | CSS `opacity` + `translateX(0→-100%)` over 400ms                         | GPU-accelerated; no layout recalc                                          |
| Pause triggers                | Hover, focus-within, `document.hidden`, `prefers-reduced-motion: reduce` | Accessibility + battery                                                    |
| Indicators                    | 3 dots below hero, current slide filled                                  | Tappable to jump                                                           |
| Manual swipe (mobile)         | Swipe left/right to jump slide                                           | Touch-native                                                               |
| Server-rendered initial slide | **Slide 1 (Lede quote)** always                                          | Prevents SSR hydration flash; Slide 1 is the fallback for reduced-motion   |
| Hydration strategy            | `useState` + `useEffect` for cycle timer; initial render is slide 1 HTML | No CLS; cycling starts after hydration completes                           |

### Accessibility requirements

- [ ] Hero wrapped in `<section aria-label="Featured stories">` with `aria-live="polite"` so screen readers announce slide changes
- [ ] Each slide has a unique heading (h2) for SR navigation
- [ ] Dot indicators are `<button>` elements with `aria-current="true"` on active
- [ ] Visible focus ring on dots + swipe targets
- [ ] `prefers-reduced-motion: reduce` → cycling disabled, slide 1 only, dots still clickable
- [ ] Keyboard: Arrow Left/Right to switch slides when focus is on hero region
- [ ] Minimum 44×44px tap targets on dots and CTAs

---

## Greeting strip design

```
APR 18, 2026  ·  What's breaking in cyber today?
```

- Date format: `MMM d, yyyy` in Inter 500 weight, uppercase, `tracking-[0.1em]`, 11px
- Separator: middle dot (·) muted-foreground
- Greeting copy: Inter 400 weight, 14px, `text-foreground`
- Bilingual: EN "What's breaking in cyber today?" / ZH "今日网安速报" (short + punchy matches Chinese rhythm)
- Full width on mobile, left-aligned
- On desktop: becomes inline with search (flex row)

Zero new i18n keys needed IF we reuse existing `home.greeting` namespace — OR add 2 new keys `home.greetingDate` + `home.greetingPrompt`.

---

## Search bar stub

```
┌─────────────────────────────────┐
│ 🔍  Search articles...          │
└─────────────────────────────────┘
```

- Full width on mobile, max-width on desktop
- Tap/click opens the existing `SearchDialog` component (already built, zero new work)
- Display-only input — NOT a form. No native keyboard on mobile unless you tap it.
- On tap: dispatches the same modal trigger that the header-level search icon uses
- Visually prominent (24px top margin) so it's the second thing users see

Reuse: `components/search/SearchDialog.tsx` + the existing `/api/search` route. No new API.

---

## CategoryPillsRow design

```
[ ALL ] [ THREAT INTEL ] [ VULNS ] [ MALWARE ] [ INDUSTRY ] [ TOOLS ] [ AI ]
```

- Horizontal scroll on mobile (overflow-x-auto, hide scrollbar)
- Pills: rounded-full, border-border, px-4 py-1.5
- Active state: primary background, primary-foreground text
- Taps route to `/[locale]/categories/[category]` (existing routes — zero new page work)
- "ALL" pill is active when on `/[locale]` (homepage)
- Bilingual via existing `categories.*` i18n namespace

No new i18n work (category names already translated).

---

## Data sources (zero new API calls)

All data already fetched in `app/[locale]/page.tsx` `HomePage()`:

- `getAllPosts(locale, "posts")` — all articles
- `getAllPosts(locale, "threat-intel")` — all threat-intel
- Combined + sorted `combined[]` — already computed
- Top 4 as `latest[]` — already computed

Phase 2 adds (in-component derivation, no new I/O):

- Slide 1 lede: `latest[0]` with truncation helper
- Slide 2 breaking: `latest.slice(0, 3)` with date-relative formatter
- Slide 3 featured threat: `tiPosts.filter(severity in set).sort(by severity desc).slice(0, 1)` — or fallback to `tiPosts[0]` if none match

All done server-side during SSR. No client fetch. No perf impact beyond rendering JSX.

---

## Files created/modified

### New files

| Path                                             | Type   | Purpose                                   |
| ------------------------------------------------ | ------ | ----------------------------------------- |
| `components/home/HomeGreeting.tsx`               | Server | Date + prompt strip                       |
| `components/home/HomeSearchBar.tsx`              | Client | Modal trigger button                      |
| `components/home/CyclingHero.tsx`                | Client | Auto-rotating hero with 3 children slides |
| `components/home/slides/LedeQuoteSlide.tsx`      | Server | Slide 1                                   |
| `components/home/slides/BreakingTickerSlide.tsx` | Server | Slide 2                                   |
| `components/home/slides/FeaturedThreatSlide.tsx` | Server | Slide 3                                   |
| `components/home/CategoryPillsRow.tsx`           | Server | Horizontal category chips                 |

All in a new `components/home/` folder to keep homepage-specific components isolated. No collisions with existing `components/articles/`, `components/threat-intel/`, etc.

### Modified files

| Path                                   | Change                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/[locale]/page.tsx`                | Delete old `LatestGrid` + old breaking-ticker div. Insert: Greeting → Search → CyclingHero → CategoryPillsRow. Keep HomeJsonLd + h1 + per-category sections + SubscribeForm. |
| `messages/en.json`, `messages/zh.json` | Add `home.greetingPrompt` (bilingual). Everything else reuses existing keys.                                                                                                 |

### NOT touched (preservation critical)

- `proxy.ts` — unchanged
- `next.config.ts` — unchanged
- `i18n/routing.ts` — unchanged
- `app/layout.tsx` — unchanged (fonts from Phase 1 still in place)
- `app/globals.css` — unchanged (Phase 1 theme + fonts intact)
- `components/ThemeProvider.tsx` — unchanged
- `app/sitemap.ts` — unchanged
- `app/robots.ts` — unchanged
- Any `[locale]/*` other than homepage `page.tsx` — unchanged
- Any API route — unchanged
- Any content MDX — unchanged
- All Phase-1-shipped typography + theme tokens — preserved

---

## Mobile-first budgets — Phase 2 MUST preserve (or improve)

| Metric                              | Phase 1 baseline | Phase 2 target                                          | Hard fail |
| ----------------------------------- | ---------------- | ------------------------------------------------------- | --------- |
| First Contentful Paint (mobile, 4G) | ~1.2s            | ≤ 1.4s                                                  | > 1.8s    |
| Largest Contentful Paint (LCP)      | ~2.1s            | ≤ 2.3s (cycling hero needs to draw Slide 1 immediately) | > 2.8s    |
| CLS                                 | ≤ 0.05           | ≤ 0.05                                                  | > 0.1     |
| Total JS (gzip)                     | ~185kb           | ≤ 195kb (adds CyclingHero client)                       | > 220kb   |
| TBT (Total Blocking Time)           | <150ms           | <200ms                                                  | > 300ms   |
| Mobile Lighthouse Performance       | ≥ 90             | ≥ 90                                                    | < 85      |

### Mobile-specific rules applied in Phase 2

1. **CyclingHero fixed height**: reserves ~200px on mobile, ~240px on desktop. All 3 slides match this height exactly. No CLS during rotation.
2. **Server-side render of Slide 1**: initial HTML contains slide 1 content. Cycling starts only after hydration (timer begins in `useEffect`). Even if JS fails to load, slide 1 is fully visible and readable.
3. **`loading="lazy"` on any slide images**: though slide 3's severity color is CSS-only (no image), future iteration may add icons — must be lazy.
4. **CSS-only transitions**: `opacity` + `transform` only. No JS animation loops. Browser compositor handles it.
5. **Category pills horizontal scroll**: native `overflow-x-auto` with momentum scrolling. No JS carousel library.
6. **Search bar**: display-only div that triggers the existing SearchDialog. Zero additional JS for the bar itself.
7. **Tap targets ≥ 44×44px**: dots (slide indicators), category pills, CTA links.
8. **Font-size floor ≥ 16px**: body text, article titles on hero slides. Eyebrows at 10-11px are fine (non-content).
9. **Touch-scroll 60fps**: test on Pixel 6a emulation with DevTools Performance.
10. **Pause on visibility hidden**: `document.addEventListener("visibilitychange", ...)` so cycling doesn't burn CPU on backgrounded tabs.

---

## SEO + CF + performance preservation

### Current state we MUST preserve (carried from Phase 1 spec)

Every SEO/CF/perf check listed in `docs/redesign-phase-1-spec.md` Section "SEO + CF + Performance preservation checklist" applies verbatim to Phase 2. Add these Phase-2-specific ones:

| Area                               | Current value                                                  | Phase 2 preservation rule                                                                           |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `<h1 class="sr-only">` on homepage | Invisible site-title anchor                                    | **DO NOT remove or change**. If Ken wants a visible h1, it must STAY as h1 — don't downgrade to h2. |
| `HomeJsonLd` emission              | Organization + WebSite schema on every homepage                | **DO NOT remove**. The new CyclingHero wraps around it, not replaces it.                            |
| Homepage canonical                 | `/{locale}`                                                    | `generateMetadata` unchanged                                                                        |
| Homepage hreflang                  | `en: /en`, `zh-Hans: /zh`, `x-default: /en`                    | unchanged                                                                                           |
| OG + Twitter on homepage           | Present                                                        | unchanged                                                                                           |
| Homepage ISR `revalidate = 3600`   | 1-hour regenerate                                              | unchanged                                                                                           |
| Breaking-ticker URL pattern        | `/[locale]/articles/[slug]` or `/[locale]/threat-intel/[slug]` | Preserved in Slide 2                                                                                |
| Category link pattern              | `/[locale]/categories/[category]`                              | Preserved in CategoryPillsRow                                                                       |
| CF cache hit rate                  | 60-75% target                                                  | Must stay ≥ 50% after Phase 2 ships; if drops below, investigate bundle changes                     |

### Post-deploy verification (required, same curl sweep as Phase 1 + new)

```bash
# Canonical + CF still working
curl -sI https://zcybernews.com/en | head -3      # 200 OK, cf-cache-status working
curl -sI https://zcybernews.com/zh | head -3      # 200 OK
curl -sI https://zcybernews.com/en/articles/2026-04-14-mirax-android-rat-proxy-botnet | head -1  # 200 (SEV3 preserved)
curl -sI https://www.zcybernews.com/ | head -2    # 308 → apex
curl -sI https://zcybernews.com/articles/x | head -2  # 308 → /en/articles/x

# Phase 2 specific
curl -sL https://zcybernews.com/en | grep -c '<script type="application/ld+json"'  # Still ≥ 2 (HomeJsonLd emits 2)
curl -sL https://zcybernews.com/en | grep -c '<h1'  # Exactly 1 (sr-only preserved)
curl -sL https://zcybernews.com/en | grep "Latest" -c  # Still ≥ 1 (per-cat sections)
```

All must pass. If ANY regress, rollback.

---

## Gate reviews (all must pass before ship)

### Ken (Design) — approves visual spec

- [ ] Mobile wireframes reviewed (greeting + search + hero + pills stack)
- [ ] Desktop wireframe reviewed (greeting + search side-by-side, hero full-width)
- [ ] Cycling timing + transition approved (10s per slide, opacity+translate)
- [ ] Severity colors (slide 3) match current CSS tokens
- [ ] Typography discipline applied per Phase 1 Pixel Street framework (eyebrows semibold, headlines serif, body Inter)
- [ ] Reduced-motion fallback design approved (slide 1 only, no dots animation)

### Vincent (Architect) — ripple analysis

- [ ] New `components/home/` folder isolates homepage logic; no cross-component coupling
- [ ] Server components vs client components split verified (only `CyclingHero` + `HomeSearchBar` are client)
- [ ] ISR compatibility verified (Slide 1 SSR'd, cycling hydrates after; cache invalidation unchanged)
- [ ] No middleware touches
- [ ] No i18n routing touches (adds only 1 new translation key per locale)
- [ ] Zero-downtime deploy verified (full-deploy job pm2 reload)

### Raymond (Engineering) — runtime/bundle

- [ ] Bundle delta ≤ 10kb (CyclingHero client is ~3-5kb gzipped)
- [ ] No new npm packages (no carousel libraries — all CSS + React state)
- [ ] Lighthouse Performance score ≥ 90 post-deploy (mobile)
- [ ] CLS stays ≤ 0.05 with fixed-height slot
- [ ] LCP stays ≤ 2.3s (SSR'd slide 1 is LCP element)
- [ ] No hydration mismatches (SSR and client render slide 1 identically)
- [ ] Test matrix: 320px, 375px, 393px (mobile) + 768px, 1024px (desktop)

### Maya (SEO / content) — semantic preservation

- [ ] h1 sr-only preserved and unique per locale
- [ ] HomeJsonLd still renders (check view-source for Organization + WebSite schema)
- [ ] Canonical + hreflang unchanged
- [ ] Meta title + description unchanged
- [ ] Internal links from hero/pills correctly use next-intl `Link` (not raw NextLink) where locale matters
- [ ] No duplicate content issue (slide 1 lede quote + breaking ticker link to same articles — Google handles this via canonical; not our problem)
- [ ] Mobile Usability (Search Console) stays clean
- [ ] Core Web Vitals (Search Console) don't regress week-over-week

### Test Automator — regression

- [ ] Admin flows spot-check: publish from /admin/compose, verify homepage hero updates via ISR revalidate
- [ ] ThemeToggle still works (light ↔ dark on homepage)
- [ ] Homepage renders on 320px (iPhone SE) without horizontal scroll
- [ ] Homepage renders on 1440px (desktop) without awkward whitespace
- [ ] CJK (/zh) renders correctly — greeting in Chinese, hero slides in Chinese, pills in Chinese
- [ ] Fresh visitor (cleared localStorage) sees light theme (Phase 1 flip preserved)
- [ ] Returning visitor (dark-toggled) still sees dark
- [ ] Existing routes all render (spot-check /articles, /threat-intel, /salary, /admin, article detail)

---

## Implementation plan

### Commit 1 (single commit — all-or-nothing)

Because the new hero replaces existing homepage structure, a partial ship would leave the page broken. Single atomic commit with these steps in order:

1. Create 7 new component files in `components/home/` + subdirectory
2. Modify `app/[locale]/page.tsx`: swap breaking-ticker + LatestGrid for Greeting + Search + CyclingHero + Pills
3. Add `home.greetingPrompt` i18n keys (EN + ZH)
4. Local QA: `npm run build` passes; `npm run start` + mobile-viewport smoke test
5. Commit + push
6. Full-deploy job rebuilds + pm2 reload
7. Post-deploy: run SEO preservation curl sweep + Lighthouse check

### Rollback

```bash
git revert <phase-2-commit-sha>
git push origin main
# Auto-deploys Phase-1 state in ~3 minutes
```

Phase 1 is the known-good fallback.

---

## Verification checklist (post-deploy)

### Functional

- [ ] `/en` loads — greeting visible, search tappable, hero shows Slide 1 initially
- [ ] Wait 10 seconds → hero transitions to Slide 2
- [ ] Wait another 10 seconds → hero transitions to Slide 3
- [ ] Tap a dot → hero jumps to that slide
- [ ] Hover hero → cycling pauses
- [ ] Move mouse away → cycling resumes
- [ ] DevTools → emulate reduced-motion → cycling stops, slide 1 stays
- [ ] Tab away from browser → cycling pauses (visibilitychange)
- [ ] Category pill "THREAT INTEL" tappable → routes to `/en/categories/threat-intel`
- [ ] `/zh` loads — all text Chinese, cycling works identically

### Mobile real-device (or emulator)

- [ ] iPhone SE 320px: no horizontal scroll
- [ ] iPhone 15 393px: comfortable reading, hero prominent
- [ ] Pixel 8 412px: same
- [ ] iPad Mini portrait 768px: breakpoint transitions smoothly

### SEO curl sweep (as above)

Every item green.

### Lighthouse

Run on `/en` homepage, mobile emulation:

- Performance ≥ 90
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO ≥ 95

---

## Sign-off

- [ ] Operator — reviews this spec and approves before implementation starts
- [ ] Alex (PM) — spec written 2026-04-18
- [ ] Ken (Design) — visual spec approved
- [ ] Vincent (Architect) — ripple review passed
- [ ] Raymond (Engineering) — bundle + CWV review passed
- [ ] Maya (SEO) — preservation review passed
- [ ] Test Automator — regression plan approved

---

## Open questions / risks

1. **Hero height reserving space on first paint**: if we pick 200px fixed but Slide 1 content is shorter, we get whitespace. Decision: 200px is the MAX; use `min-height` so shorter slides pad out. Slide 3 (severity card) is tallest — size to it.
2. **If no threat-intel with severity in last 7 days**: spec says fall back to most-recent TI regardless of severity. If there's literally ZERO threat-intel in the dataset (e.g. fresh install): skip slide 3 entirely → cycle between slides 1 and 2 only. Operator acknowledges.
3. **Breaking-ticker removal from current position**: old design had it as a red bar across the top. New design moves this UX into Slide 2. Some users might miss "the red breaking bar" pattern. Accepted trade-off — hero treatment is stronger anchor.
4. **Desktop layout minimalism**: we're not doing multi-column desktop layout in Phase 2. Some desktop visitors may find the mobile-derived layout "too spacious." That's Phase 3's problem. If operator wants desktop richness sooner, we can add a "desktop-only" 2-column hero variant later.
5. **Cycling on low-battery mobile**: hero pause on `navigator.getBattery()?.charging === false && battery.level < 0.2`? Over-engineering. Skip.
6. **Cycling interaction with scroll**: once user scrolls past the hero, cycling continues off-screen. Should it pause? Recommend: pause when hero is off-screen via IntersectionObserver. 2 lines of JS, saves CPU.
7. **i18n greeting tone**: EN "What's breaking in cyber today?" is casual. ZH "今日网安速报" is formal/newscaster. Operator veto? Flag if ZH tone needs adjustment.

---

## What's DEFERRED to Phase 3 / 4

- Per-category section redesign (NYT/Vertonews multi-column card layout)
- Article listing page redesign
- Article detail page polish
- Desktop multi-column hero (if Phase 2's single-column feels too sparse)
- Photo-hero treatment (once we have article hero photos — separate content initiative)
- Dark-mode specific hero styling refinements
- Cycling animation polish (parallax, blur transitions — Phase 2 uses simple opacity+translate)

Each gets its own spec doc + gate review when the time comes.

---

## Timeline (realistic, not padded)

Assuming green-light from operator after spec review:

| Step                                                     | Est. duration                                        |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Ken finalizes Figma wireframes                           | 1-2 hours                                            |
| Raymond implements 7 components + homepage integration   | 3-4 hours                                            |
| Local QA + mobile emulator pass                          | 1 hour                                               |
| Gate reviews (Vincent / Raymond / Maya / Test Automator) | 1-2 hours (may loop)                                 |
| Deploy + post-deploy verification                        | 30 min                                               |
| **Total**                                                | **~6-9 hours of implementation after spec approval** |

Not shipping today. Queued for the session after operator reviews this doc.
