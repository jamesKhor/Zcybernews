import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ArticleWithSource } from "@/lib/homepage-picks";
import { relativeTime } from "@/lib/homepage-picks";

/**
 * "More from today" ticker strip — Region 2 of Phase 2 homepage.
 *
 * Full-width below hero. 5 rows of latest articles (excluding hero picks).
 * Each row: time · category chip · title. Rows are tappable.
 *
 * Server component — no interactivity beyond navigation.
 */

interface Props {
  articles: ArticleWithSource[];
  locale: "en" | "zh";
}

function hrefFor(a: ArticleWithSource, locale: string): string {
  const seg = a._sourceType === "threat-intel" ? "threat-intel" : "articles";
  return `/${locale}/${seg}/${a.frontmatter.slug}`;
}

const CATEGORY_HSL: Record<string, string> = {
  "threat-intel": "var(--cat-threat-intel)",
  vulnerabilities: "var(--cat-vulnerabilities)",
  malware: "var(--cat-malware)",
  industry: "var(--cat-industry)",
  tools: "var(--cat-tools)",
  ai: "var(--cat-ai)",
};

export function MoreFromToday({ articles, locale }: Props) {
  const t = useTranslations("home");
  const tCats = useTranslations("categories");

  if (articles.length === 0) return null;

  return (
    <section
      aria-label={t("moreFromTodayAriaLabel")}
      className="max-w-7xl mx-auto px-4 py-6 sm:py-8 border-t border-border"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] font-mono uppercase tracking-[0.2em] font-bold text-foreground">
          {t("moreFromToday")}
        </h2>
        <Link
          href={`/${locale}/articles`}
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {t("seeAll")} →
        </Link>
      </div>

      <ul className="divide-y divide-border/60">
        {articles.map((a) => {
          const catColor =
            CATEGORY_HSL[a.frontmatter.category as string] ?? "var(--primary)";
          return (
            <li key={a.frontmatter.slug}>
              <Link
                href={hrefFor(a, locale)}
                className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-3 sm:gap-4 py-3 hover:bg-secondary/40 transition-colors rounded -mx-2 px-2 group"
              >
                <span className="text-[11px] font-mono font-semibold tabular-nums text-muted-foreground/80 w-8">
                  {relativeTime(a.frontmatter.date)}
                </span>
                <span
                  className="text-[10px] font-mono uppercase tracking-[0.1em] font-semibold whitespace-nowrap"
                  style={{ color: `hsl(${catColor})` }}
                >
                  {tCats(a.frontmatter.category)}
                </span>
                <span className="text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1">
                  {a.frontmatter.title}
                </span>
                <span
                  className="text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0"
                  aria-hidden
                >
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
