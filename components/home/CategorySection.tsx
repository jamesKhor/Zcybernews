import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { stripMarkdown } from "@/lib/utils";
import { CATEGORY_DEFAULT_IMAGES, type Category } from "@/lib/types";
import type { Article } from "@/lib/content";
import {
  VulnCard,
  MalwareCard,
  IndustryCard,
  AICard,
  GenericTypographyCard,
} from "./typography-cards";

/**
 * Per-category homepage section (Phase 2, 2026-04-18).
 *
 * Dispatches to photo-forward or typography-forward layout per spec:
 *   Photo-forward:     threat-intel, tools (lead-with-photo / 2 typography stacked)
 *   Typography-forward: vulnerabilities, malware, industry, ai (3 equal cards)
 *
 * Server component. Reads category and selects the right layout.
 */

type TypographyCategory = "vulnerabilities" | "malware" | "industry" | "ai";

const PHOTO_FORWARD: readonly string[] = ["threat-intel", "tools"];

interface Props {
  category: Category;
  articles: Article[];
  locale: "en" | "zh";
  sourceType: "posts" | "threat-intel";
}

const CATEGORY_HSL: Record<string, string> = {
  "threat-intel": "var(--cat-threat-intel)",
  vulnerabilities: "var(--cat-vulnerabilities)",
  malware: "var(--cat-malware)",
  industry: "var(--cat-industry)",
  tools: "var(--cat-tools)",
  ai: "var(--cat-ai)",
};

export function CategorySection({
  category,
  articles,
  locale,
  sourceType,
}: Props) {
  const tCats = useTranslations("categories");
  const tHome = useTranslations("home");

  if (articles.length === 0) return null;

  const catColor = CATEGORY_HSL[category] ?? "var(--primary)";
  const isPhotoForward = PHOTO_FORWARD.includes(category);

  return (
    <section className="max-w-7xl mx-auto px-4 py-6 sm:py-10">
      {/* Section header with colored accent bar */}
      <div className="flex items-center justify-between mb-5 sm:mb-6 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span
            className="h-5 w-1.5 rounded-sm"
            style={{ backgroundColor: `hsl(${catColor})` }}
            aria-hidden
          />
          <h2 className="font-serif text-lg sm:text-xl font-bold uppercase tracking-wide text-foreground">
            {tCats(category)}
          </h2>
        </div>
        <Link
          href={`/${locale}/categories/${category}`}
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {tHome("seeAll")} →
        </Link>
      </div>

      {isPhotoForward ? (
        <PhotoForwardBody
          articles={articles}
          locale={locale}
          sourceType={sourceType}
        />
      ) : (
        <TypographyBody
          category={category as TypographyCategory}
          articles={articles}
          locale={locale}
          sourceType={sourceType}
        />
      )}
    </section>
  );
}

// ─── Photo-forward body (threat-intel, tools) ──────────────────────────

function PhotoForwardBody({
  articles,
  locale,
  sourceType,
}: {
  articles: Article[];
  locale: string;
  sourceType: "posts" | "threat-intel";
}) {
  const tArt = useTranslations("article");
  const [lead, ...rest] = articles;
  if (!lead) return null;
  const supporting = rest.slice(0, 2);

  const leadImage =
    lead.frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[lead.frontmatter.category as Category];
  const leadSeg = sourceType === "threat-intel" ? "threat-intel" : "articles";
  const leadHref = `/${locale}/${leadSeg}/${lead.frontmatter.slug}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-8">
      {/* Lead with photo */}
      <Link
        href={leadHref}
        className="group flex flex-col rounded-md border border-border bg-card hover:border-foreground/20 transition-colors overflow-hidden"
      >
        <div className="relative aspect-[16/9] bg-secondary">
          {leadImage ? (
            <Image
              src={leadImage}
              alt={
                lead.frontmatter.featured_image_alt ?? lead.frontmatter.title
              }
              fill
              sizes="(max-width: 1024px) 100vw, 55vw"
              className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-transparent" />
          )}
        </div>
        <div className="flex flex-col gap-2 p-5 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.15em] font-semibold text-muted-foreground">
            {lead.frontmatter.severity && (
              <span
                className="text-foreground"
                style={{
                  color: `hsl(var(--severity-${lead.frontmatter.severity}))`,
                }}
              >
                {lead.frontmatter.severity}
              </span>
            )}
            {lead.frontmatter.severity && (
              <span className="text-border" aria-hidden>
                ·
              </span>
            )}
            <span>
              {new Date(lead.frontmatter.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="ml-auto font-medium normal-case tracking-normal text-muted-foreground/80">
              {tArt("readingTime", { minutes: lead.readingTime })}
            </span>
          </div>
          <h3 className="font-serif text-xl sm:text-2xl font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-3">
            {lead.frontmatter.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {stripMarkdown(lead.frontmatter.excerpt)}
          </p>
          {lead.frontmatter.tags && lead.frontmatter.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
              {lead.frontmatter.tags.slice(0, 3).map((tag) => (
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

      {/* 2 supporting typography cards */}
      <div className="flex flex-col gap-4 sm:gap-5">
        {supporting.map((a) => (
          <GenericTypographyCard
            key={a.frontmatter.slug}
            article={a}
            locale={locale}
            sourceType={sourceType}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Typography-forward body (vulns, malware, industry, ai) ────────────

function TypographyBody({
  category,
  articles,
  locale,
  sourceType,
}: {
  category: TypographyCategory;
  articles: Article[];
  locale: string;
  sourceType: "posts" | "threat-intel";
}) {
  const cards = articles.slice(0, 3);
  const CardComp =
    category === "vulnerabilities"
      ? VulnCard
      : category === "malware"
        ? MalwareCard
        : category === "industry"
          ? IndustryCard
          : AICard;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
      {cards.map((a) => (
        <CardComp
          key={a.frontmatter.slug}
          article={a}
          locale={locale}
          sourceType={sourceType}
        />
      ))}
    </div>
  );
}
