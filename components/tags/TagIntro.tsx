import type { TagIntro as TagIntroRecord } from "@/lib/tag-intros";

interface Props {
  intro: TagIntroRecord;
  locale: "en" | "zh";
}

/**
 * Renders a grounded, fact-derived intro above the tag article grid.
 * Prose comes from data/tag-intros/{locale}/{tag}.json — see
 * scripts/tag-intros/ pipeline for how it's generated.
 *
 * Mobile-first: `min-w-0` on the wrapper (per portfolio rule in
 * memory: feedback_flex_item_min_width.md) to prevent CJK content from
 * dragging the flex parent past viewport.
 */
export function TagIntro({ intro, locale }: Props) {
  // Detect inline code markers from the template (backticks around the tag name)
  // and render them as <code>. LLM outputs don't use them; only templates do.
  const parts = intro.intro.split(/(`[^`]+`)/g);

  return (
    <section
      className="min-w-0 mb-8 max-w-3xl"
      aria-label={locale === "zh" ? "标签概览" : "Tag overview"}
    >
      <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
        {parts.map((part, i) =>
          part.startsWith("`") && part.endsWith("`") ? (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[0.85em] font-mono"
            >
              {part.slice(1, -1)}
            </code>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </section>
  );
}
