import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { stripMarkdown } from "@/lib/utils";
import { CATEGORY_DEFAULT_IMAGES, type Category } from "@/lib/types";
import type { ArticleWithSource, HeroPicks } from "@/lib/homepage-picks";
import { relativeTime } from "@/lib/homepage-picks";

/**
 * 3-column mixed-category hero for the homepage (Phase 2, 2026-04-18).
 *
 * Layout (desktop ≥lg): 3-column CSS grid.
 *   LEFT  (text-forward)    — category-colored left-border, no photo
 *   CENTER (photo lead)     — THE ONE photo on the page, title below
 *   RIGHT (severity-tint)   — full severity-color tint + thick border
 *
 * Mobile (<lg): stacks vertically, same content order.
 *
 * Each column has a DIFFERENT visual treatment — distinct roles create
 * editorial variety. Reader sees "urgency / visual anchor / impact score"
 * in 3 different presentations rather than 3 identical cards.
 *
 * Server component. All selection happens in lib/homepage-picks.ts.
 */

interface Props {
  picks: HeroPicks;
  locale: "en" | "zh";
}

function hrefFor(a: ArticleWithSource, locale: string): string {
  const seg = a._sourceType === "threat-intel" ? "threat-intel" : "articles";
  return `/${locale}/${seg}/${a.frontmatter.slug}`;
}

const SEVERITY_HSL: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
};

const CATEGORY_HSL: Record<string, string> = {
  "threat-intel": "var(--cat-threat-intel)",
  vulnerabilities: "var(--cat-vulnerabilities)",
  malware: "var(--cat-malware)",
  industry: "var(--cat-industry)",
  tools: "var(--cat-tools)",
  ai: "var(--cat-ai)",
};

export function Hero3Col({ picks, locale }: Props) {
  const tCats = useTranslations("categories");
  const tArt = useTranslations("article");
  const tHome = useTranslations("home");

  return (
    <section
      aria-label={tHome("heroAriaLabel")}
      className="max-w-7xl mx-auto px-4 py-6 sm:py-10"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr_1fr] gap-6 lg:gap-8">
        {picks.left && (
          <HeroLeft
            article={picks.left}
            locale={locale}
            catLabel={tCats(picks.left.frontmatter.category)}
            readMoreLabel={tHome("seeMoreUpdates")}
          />
        )}
        {picks.center && (
          <HeroCenter
            article={picks.center}
            locale={locale}
            catLabel={tCats(picks.center.frontmatter.category)}
            readMinutesLabel={tArt("readingTime", {
              minutes: picks.center.readingTime,
            })}
          />
        )}
        {picks.right && (
          <HeroRight
            article={picks.right}
            locale={locale}
            catLabel={tCats(picks.right.frontmatter.category)}
            readLabel={tHome("read")}
          />
        )}
      </div>
    </section>
  );
}

// ─── LEFT: text-forward lead ─────────────────────────────────────────────

function HeroLeft({
  article,
  locale,
  catLabel,
  readMoreLabel,
}: {
  article: ArticleWithSource;
  locale: string;
  catLabel: string;
  readMoreLabel: string;
}) {
  const { frontmatter, readingTime } = article;
  const catColor =
    CATEGORY_HSL[frontmatter.category as string] ?? "var(--primary)";

  return (
    <Link
      href={hrefFor(article, locale)}
      className="group flex flex-col gap-3 pl-5 pr-2 py-4 border-l-4 hover:bg-secondary/40 transition-colors rounded-r"
      style={{ borderLeftColor: `hsl(${catColor})` }}
    >
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] font-semibold">
        {frontmatter.severity && frontmatter.severity !== "informational" && (
          <>
            <span
              style={{
                color: `hsl(${SEVERITY_HSL[frontmatter.severity]})`,
              }}
            >
              {frontmatter.severity}
            </span>
            <span className="text-border" aria-hidden>
              ·
            </span>
          </>
        )}
        <span className="text-muted-foreground">{catLabel}</span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">
          {relativeTime(frontmatter.date)}
        </span>
      </div>

      <h2 className="font-serif text-[1.75rem] sm:text-[2rem] lg:text-[2.25rem] font-bold leading-[1.05] tracking-tight text-foreground group-hover:text-primary transition-colors">
        {frontmatter.title}
      </h2>

      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed line-clamp-4">
        {stripMarkdown(frontmatter.excerpt)}
      </p>

      <span className="mt-auto pt-2 text-sm font-medium text-primary group-hover:underline underline-offset-4">
        {readMoreLabel} →
      </span>

      <span className="text-[11px] font-mono text-muted-foreground/70 tabular-nums">
        {readingTime} min read
      </span>
    </Link>
  );
}

// ─── CENTER: photo lead — THE ONE photo on the page ──────────────────────

function HeroCenter({
  article,
  locale,
  catLabel,
  readMinutesLabel,
}: {
  article: ArticleWithSource;
  locale: string;
  catLabel: string;
  readMinutesLabel: string;
}) {
  const { frontmatter } = article;
  const image =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];

  return (
    <Link
      href={hrefFor(article, locale)}
      className="group flex flex-col rounded-md overflow-hidden border border-border bg-card hover:border-foreground/20 transition-colors"
    >
      <div className="relative aspect-[4/3] bg-secondary overflow-hidden">
        {image ? (
          <Image
            src={image}
            alt={frontmatter.featured_image_alt ?? frontmatter.title}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 45vw"
            className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/10 to-transparent" />
        )}
      </div>

      <div className="flex flex-col gap-2 p-5 flex-1">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] font-semibold text-muted-foreground">
          <span>{catLabel}</span>
          <span className="text-border" aria-hidden>
            ·
          </span>
          <span>{relativeTime(frontmatter.date)}</span>
          <span className="text-border ml-auto" aria-hidden>
            ·
          </span>
          <span className="font-medium normal-case tracking-normal text-muted-foreground/80">
            {readMinutesLabel}
          </span>
        </div>

        <h2 className="font-serif text-xl sm:text-2xl font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-3">
          {frontmatter.title}
        </h2>

        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
          {stripMarkdown(frontmatter.excerpt)}
        </p>

        {frontmatter.tags && frontmatter.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
            {frontmatter.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded-sm border border-border/60 bg-background/50 text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── RIGHT: severity-forward tint card ───────────────────────────────────

function HeroRight({
  article,
  locale,
  catLabel,
  readLabel,
}: {
  article: ArticleWithSource;
  locale: string;
  catLabel: string;
  readLabel: string;
}) {
  const { frontmatter } = article;
  const severity = frontmatter.severity ?? "informational";
  const sevColor = SEVERITY_HSL[severity];

  return (
    <Link
      href={hrefFor(article, locale)}
      className="group flex flex-col gap-3 pl-5 pr-5 py-5 border-l-[6px] rounded-r-md hover:bg-secondary/60 transition-colors"
      style={{
        borderLeftColor: `hsl(${sevColor})`,
        // Subtle tint — 6% opacity of severity color
        backgroundColor: `hsl(${sevColor} / 0.06)`,
      }}
    >
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] font-bold">
        <span style={{ color: `hsl(${sevColor})` }}>{severity}</span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">{catLabel}</span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">
          {relativeTime(frontmatter.date)}
        </span>
      </div>

      {frontmatter.cve_ids && frontmatter.cve_ids.length > 0 && (
        <p className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {frontmatter.cve_ids[0]}
        </p>
      )}

      <h2 className="font-serif text-lg sm:text-xl font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-3">
        {frontmatter.title}
      </h2>

      {typeof frontmatter.cvss_score === "number" && (
        <p className="text-xs font-mono text-muted-foreground tabular-nums">
          CVSS {frontmatter.cvss_score.toFixed(1)}
          {frontmatter.affected_sectors &&
            frontmatter.affected_sectors.length > 0 && (
              <>
                {" · "}
                <span className="normal-case">
                  {frontmatter.affected_sectors.slice(0, 2).join(", ")}
                </span>
              </>
            )}
        </p>
      )}

      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
        {stripMarkdown(frontmatter.excerpt)}
      </p>

      <span className="mt-auto pt-2 text-sm font-medium text-primary group-hover:underline underline-offset-4">
        {readLabel} →
      </span>
    </Link>
  );
}
