# Salary Page — Perf & Mobile Tracker

**Status:** OPEN — two P0 defects in flight
**Owner (PM):** Alex
**Owner (Eng):** Raymond
**Opened:** 2026-04-18
**Pages affected:** `/zh/salary`, `/en/salary` (production)
**Loop mandate:** Founder has said "loop until good." Do not close this tracker until both acceptance criteria pass with measurements attached.

---

## Defects

### P0-1 — Mobile horizontal overflow

- **Symptom:** Page content overshoots viewport width on iPhone 16. Founder has to pinch-zoom-out to see full layout.
- **Reproduction:** Open `https://zcybernews.com/zh/salary` (or `/en/salary`) on iPhone 16 Safari/Chrome at default zoom. Observe horizontal scroll / content clipped right of viewport.
- **Severity:** P0 — salary page is the XHS career-funnel landing destination (posts #181-#189). Broken mobile = funnel dead.
- **Earlier attempt:** Commit `fe9645c` added `html, body { overflow-x: clip; }` in `app/globals.css` + explicit `viewport` export in `app/layout.tsx`.
- **Current status:** Founder reports fix did NOT take effect in production. Unclear whether deployed CSS bundle contains the rule or the deploy path dropped the change.

### P0-2 — Desktop resize lag

- **Symptom:** Dragging the browser window edge to resize produces extreme CPU lag, "mouse jiggle," visible frame drops.
- **Reproduction:** Open `/en/salary` or `/zh/salary` in desktop Chrome at 1440×900. Drag window width from 1440 → 375 in one continuous motion. CPU pegs, cursor lags behind drag handle.
- **Severity:** P0 — polish signal for recruiter / operator demo context; also a proxy for real CPU cost on mid-tier mobile.
- **Root cause (engineering):** `text-[14vw]` / `text-[16vw]` classes (10 occurrences) force full layout + paint recalc on every viewport-width pixel. Combined with 70 `<article>` + 37 `<h3>` on the page, browser re-lays-out a dense grid continuously during resize.
- **Not the cause:** 775KB HTML payload is heavy but server TTFB = 180ms (fine). Lag is pure client-side style/layout thrashing.

---

## Investigation log

### 2026-04-18 PM

- **Measured page weight:** HTML payload = 775KB. Server TTFB = 180ms. Network is not the bottleneck.
- **DOM density audit:**
  - `<article>` count = 70
  - `<h3>` count = 37
  - `text-[Nvw]` classes = 10× (mix of `14vw` and `16vw`, primarily in `CinematicHero` + `HeroStats`)
- **Layout thrash hypothesis confirmed:** vw-based unbounded sizing means every resize pixel re-computes font size → re-lays-out every descendant. No `contain` hints → browser has to reflow the whole document.
- **Overflow fix verification:** Commit `fe9645c` merged, but production behavior unchanged. Need to (a) confirm `.next` artifact on VPS contains the new `globals.css`, (b) check CF cache served the new CSS hash, (c) confirm no upstream element sets an explicit width > 100vw.
- **Suspected overflow offenders (to audit):** hero ticker marquee, CinematicHero typography (if `text-[16vw]` × long string pushes a non-wrapping line), SalaryCard grid gutters at small widths.

---

## Fix in flight

Engineering (Raymond) is shipping now:

1. **Replace unbounded `text-[Nvw]` with `clamp()`** across `CinematicHero` and `HeroStats` — e.g. `text-[16vw]` → `text-[clamp(3rem,16vw,12rem)]`. Caps max size so resize past the clamp ceiling is a no-op for layout.
2. **Add CSS `contain: layout paint`** to:
   - `CinematicHero` root (`app/[locale]/salary/CinematicHero.tsx:135`)
   - `HeroStats` root
   - `SalaryCard` / results grid root
     Isolates layout + paint scope so resize doesn't reflow the whole doc.
3. **Verify `overflow-x: clip` actually deployed:**
   - SSH to VPS, check `.next/static/css/*.css` for the rule
   - Curl the production CSS URL, grep for `overflow-x:clip`
   - If missing → re-deploy; if present but ineffective → audit for inner element with `width: > 100vw` or negative margin leak
4. **Optional (if still janky):** Add `content-visibility: auto` + `contain-intrinsic-size` to off-screen `SalaryCard` rows to skip layout entirely until scrolled into view.

---

## Acceptance criteria

Both must pass with evidence (screenshot / DevTools recording) before closing tracker.

**AC-1 (Mobile overflow — P0-1):**

- On **iPhone 15 Pro Chrome @ 375×812 viewport**, `/zh/salary` AND `/en/salary` render with **zero horizontal scroll** at default zoom (no rightward pan possible, no content clipped right of viewport).
- Verified on real device (founder's iPhone 16) — founder confirms pinch-zoom-out is no longer needed.
- `document.documentElement.scrollWidth <= window.innerWidth` in DevTools console on both pages.

**AC-2 (Desktop resize smoothness — P0-2):**

- On **1440×900 desktop Chrome**, drag-resize window from **1440 → 375 width** in one continuous motion.
- DevTools Performance recording shows **<16ms per frame** (60fps target) for the duration of the drag. No red "long task" bars on the main thread > 50ms.
- Visually: cursor tracks the drag handle with no perceptible jiggle or stutter.

---

## Loop mandate

Per founder direction, this tracker stays OPEN and engineering iterates until both ACs pass:

1. Ship fix → measure → attach results to a new `## YYYY-MM-DD` investigation-log entry
2. If AC not met → diagnose next bottleneck, ship next fix, re-measure
3. Only close the tracker when **both AC-1 and AC-2 pass with evidence attached**
4. If blocked or uncertain, escalate to Alex before abandoning a fix path

---

## Related commits

- `fe9645c` — **shipped** — added `html, body { overflow-x: clip; }` in `app/globals.css` + `viewport` export in `app/layout.tsx`. Fix did not take effect on production; deployment verification pending.
- `<pending>` — **in flight** — `text-[Nvw]` → `clamp()` across `CinematicHero` + `HeroStats`, `contain: layout paint` on hero + stats + results grid, deploy verification of overflow-x rule.

---

## File references

- `app/[locale]/salary/CinematicHero.tsx:135` — hero root, target for `contain: layout paint` + `clamp()` refactor
- `app/[locale]/salary/HeroStats.tsx` — secondary vw-sized typography site
- `app/[locale]/salary/SalaryCard.tsx` — grid child, candidate for `content-visibility: auto`
- `app/globals.css` — `overflow-x: clip` rule (verify shipped)
- `app/layout.tsx` — `viewport` export (verify shipped)
