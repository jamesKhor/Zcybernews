/**
 * TLDR callout (B-022, 2026-04-23) — editorial summary card shown
 * above the article body when `frontmatter.tldr` is present.
 *
 * Visual style mirrors the site's `/sources` editor's-note pattern:
 * left-edge color bar, subtle tint background, serif italic body,
 * small uppercase eyebrow. Reads as an editor's note, not a marketing
 * banner.
 *
 * Renders nothing when `tldr` is absent — non-disruptive for legacy
 * articles that don't have the field.
 */
interface Props {
  tldr?: string;
  locale: string;
}

export function TldrCallout({ tldr, locale }: Props) {
  if (!tldr || tldr.trim().length === 0) return null;

  const eyebrow = locale === "zh" ? "一句话速览" : "TL;DR";

  return (
    <aside
      aria-label={eyebrow}
      className="mb-8 border-l-2 border-primary/60 bg-primary/5 pl-4 pr-3 py-3 md:py-4 rounded-sm"
    >
      <p className="text-[10px] md:text-[11px] font-semibold uppercase tracking-[0.12em] text-primary mb-2">
        {eyebrow}
      </p>
      <p className="font-serif italic text-[15px] md:text-base leading-relaxed text-foreground/90">
        {tldr}
      </p>
    </aside>
  );
}
