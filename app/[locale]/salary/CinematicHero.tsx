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
      className="relative isolate -mx-4 sm:-mx-6 mb-12 sm:mb-16 overflow-hidden bg-black"
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

      {/* Content. min-height pushes the hero close to full viewport on
          desktop but caps on mobile so the user can still see the body
          copy + CTA without scrolling. */}
      <div className="relative mx-auto max-w-7xl px-4 sm:px-8 py-16 sm:py-24 md:py-32 min-h-[80vh] sm:min-h-[88vh] flex flex-col justify-between gap-12">
        {/* TOP: wordmark, 4 lines, alternating opacity */}
        <div aria-hidden className="flex flex-col">
          {[
            { text: labels.w1, strong: false, align: "text-left" },
            { text: labels.w2, strong: true, align: "text-left sm:pl-[8%]" },
            { text: labels.w3, strong: true, align: "text-right sm:pr-[4%]" },
            { text: labels.w4, strong: false, align: "text-right" },
          ].map((line, i) => (
            <div
              key={i}
              className={`font-black leading-[0.88] tracking-tight uppercase
                text-[18vw] sm:text-[16vw] md:text-[14vw] lg:text-[13rem] xl:text-[15rem]
                ${line.align}
                ${line.strong ? "text-white" : "text-white/[0.14]"}
                ${i > 0 ? "-mt-[0.08em]" : ""}`}
              style={{
                fontFamily: "var(--font-sans-stack)",
                // Slight letter-spacing tightening at very large sizes
                // so the word looks crafted, not defaulted.
                letterSpacing: "-0.035em",
                // Subtle text-shadow on strong lines for cinematic glow
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
