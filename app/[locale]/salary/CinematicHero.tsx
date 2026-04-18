/**
 * CinematicHero — server component, full-viewport landing hero.
 *
 * Visual references (operator-supplied 2026-04-17):
 *   1. TX3 Funding FX — "GROW YOUR TRADING SKILLS" split across 3 lines,
 *      alternating opacity (strong / ghost / strong / ghost rhythm),
 *      3D circuit-board photo backdrop, single white CTA.
 *   2. Planck — "The World's First Layer-0 For AI And DePIN" centered,
 *      massive geometric sans, dark backdrop, single dramatic element
 *      (cube + particle rocket trail).
 *
 * Synthesis for /salary:
 *   - Headline: "GROW YOUR CYBER CAREER" split across 3 lines
 *   - Pattern: GROW (ghost) · YOUR (strong) · CYBER (strong) · CAREER (ghost)
 *     — viewer's eye lands on YOUR CYBER first, fills in GROW...CAREER
 *   - Body copy bottom-left, lowercase muted paragraph
 *   - Single white pill CTA: "Explore 2026 Salary Data →"
 *   - Backdrop: pure CSS gradient + subtle animated grid overlay +
 *     radial "burn" glow (the "rocket/burning" element the operator
 *     referenced). Zero asset download cost, scales on any device.
 *
 * Editorial rationale (per 小鹿Lawrence "Pixel Street" framework):
 *   - Title = bandit: grab attention, set emotional tone
 *   - Heavy font-black weight because short display words need weight
 *   - Alternating opacity = rhythm device, not decoration
 *
 * SEO note: the actual <h1> lives in the breadcrumbed header ABOVE this
 * hero for proper heading hierarchy + rich results. The hero's words
 * are aria-hidden decorative (they're the same semantic idea as the h1
 * but in display form). This matches NYT's pattern where a magazine
 * lede headline can be cinematic while the indexable h1 is plain text.
 */
interface Props {
  locale: "en" | "zh";
  labels: {
    // Four words, each rendered as its own line
    w1: string;
    w2: string;
    w3: string;
    w4: string;
    // Body copy bottom-left
    body: string;
    // CTA on the button
    cta: string;
    // Which words are "strong" (full opacity) vs "ghost" (muted)
    // Pattern default: ghost, strong, strong, ghost
  };
}

export function CinematicHero({ labels }: Props) {
  return (
    <section
      aria-label="Salary data lede"
      // layout-isolate (from globals.css) adds `contain: layout paint`
      // so descendants can't invalidate ancestor layout on resize —
      // critical for 60fps drag-resize since this hero otherwise re-
      // cascades every vw-sized child on every pixel of mouse movement.
      className="relative isolate -mx-4 sm:-mx-6 mb-12 sm:mb-16 overflow-hidden bg-black layout-isolate"
    >
      {/* ── Backdrop layer stack ────────────────────────────────────
          1) Radial "burn" glow — the rocket/flame element, bottom-right
          2) Circuit grid — subtle dotted pattern, low opacity
          3) Vignette — edges darker so text pops
          All pure CSS, no images, no JS. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          // Radial flame at bottom-right: warm amber → transparent
          backgroundImage: `
            radial-gradient(ellipse 70% 50% at 85% 100%,
              rgba(251, 146, 60, 0.22) 0%,
              rgba(251, 146, 60, 0.10) 30%,
              transparent 70%),
            radial-gradient(ellipse 90% 60% at 15% 0%,
              rgba(6, 182, 212, 0.10) 0%,
              transparent 60%),
            linear-gradient(180deg, #0a0a0a 0%, #000 100%)
          `,
        }}
      />
      {/* Dotted circuit grid */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)
          `,
          backgroundSize: "32px 32px",
        }}
      />
      {/* Edge vignette */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          boxShadow: "inset 0 0 200px 40px rgba(0,0,0,0.85)",
        }}
      />

      {/* Content. min-height is tuned per breakpoint:
            - Mobile (< 640px): 62vh — enough for full wordmark + CTA
              above the keyboard/fold on a 6" phone, not so tall that
              users must scroll past empty space to reach data.
            - Desktop (>= 640px): 88vh — full cinematic moment.
          Padding + gap also shrunk on mobile so the 4-line wordmark
          doesn't squeeze the body copy off-screen on narrow devices. */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-8 py-10 sm:py-24 md:py-32 min-h-[62vh] sm:min-h-[88vh] flex flex-col justify-between gap-6 sm:gap-12 overflow-hidden">
        {/* TOP: wordmark, 4 lines, alternating opacity.
            Overflow containment: the outer section already has
            overflow-hidden, but we belt-and-braces here with overflow-hidden
            again + w-full so any vw-sized text that spills gets clipped
            rather than scroll-bleeding the page. */}
        <div aria-hidden className="flex flex-col w-full overflow-hidden">
          {[
            { text: labels.w1, strong: false, align: "text-left" },
            // Mobile overflow fix (2026-04-18): alignment offsets `pl-[8%]`
            // and `pr-[4%]` pushed text past the 375px viewport on phones
            // when combined with -0.035em letter-spacing + wide CJK glyphs
            // (加速, 你的, 网安 etc. render ~1.4× wider than Latin in mono
            // fonts). Scoped to sm+ so mobile uses straight left/right.
            { text: labels.w2, strong: true, align: "text-left sm:pl-[8%]" },
            { text: labels.w3, strong: true, align: "text-right sm:pr-[4%]" },
            { text: labels.w4, strong: false, align: "text-right" },
          ].map((line, i) => (
            <div
              key={i}
              // font-display routes through the CJK-safe stack. font-black
              // (900) gives short display words the weight the Pixel Street
              // framework prescribes.
              // Mobile vw sizing fix (2026-04-18): dropped 17vw → 14vw on
              // phones (iPhone SE 320px × 14vw = 44px, iPhone 15 393px ×
              // 14vw = 55px — fits 6-char Latin and 2-char CJK comfortably
              // with headroom for letter-spacing + alignment nudges).
              // leading-[0.9] gives a bit more vertical breathing room than
              // 0.86 — CJK glyphs need more height to avoid clipping their
              // top/bottom strokes.
              className={`font-display font-black leading-[0.9] sm:leading-[0.86] tracking-tight uppercase
                text-[clamp(2.5rem,14vw,5.5rem)] sm:text-[clamp(4rem,16vw,10rem)] md:text-[clamp(5rem,14vw,12rem)] lg:text-[13rem] xl:text-[15rem]
                ${line.align}
                ${line.strong ? "text-white" : "text-white/[0.14]"}
                ${i > 0 ? "-mt-[0.06em] sm:-mt-[0.08em]" : ""}`}
              style={{
                // Tighten letter-spacing at display sizes so the word
                // looks crafted, not defaulted. Less aggressive on mobile
                // because CJK glyphs overlap more than Latin at the same
                // negative tracking.
                letterSpacing: "-0.02em",
                textShadow: line.strong
                  ? "0 0 40px rgba(6, 182, 212, 0.15)"
                  : undefined,
              }}
            >
              {line.text}
            </div>
          ))}
        </div>

        {/* BOTTOM: body copy (left) + CTA button (below on mobile, inline on desktop) */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 max-w-full">
          <p className="text-sm sm:text-base text-white/70 leading-relaxed max-w-sm">
            {labels.body}
          </p>
          <a
            href="#dataset"
            className="inline-flex items-center gap-2 shrink-0
              bg-white text-black
              text-sm sm:text-base font-semibold
              px-6 sm:px-7 py-3 sm:py-3.5 rounded-sm
              hover:bg-white/90 active:bg-white/80
              transition-colors
              shadow-[0_4px_24px_rgba(255,255,255,0.08)]"
          >
            <span>{labels.cta}</span>
            <span aria-hidden className="transition-transform">
              →
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
