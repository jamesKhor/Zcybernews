import { getAllPosts } from "@/lib/content";
import { isPublicArticle } from "@/lib/publication";
import { ArticleCard } from "@/components/articles/ArticleCard";
import {
  VulnCard,
  MalwareCard,
  IndustryCard,
  AICard,
} from "@/components/home/typography-cards";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoryEnum, getCategoryDefaultImage } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

interface Props {
  params: Promise<{ locale: string; category: string }>;
}

// Per-category hue tokens — matches the homepage CategorySection bar so
// the accent color is consistent whether the reader lands on the
// homepage or straight into a category listing.
const CATEGORY_HSL: Record<string, string> = {
  "threat-intel": "var(--cat-threat-intel)",
  vulnerabilities: "var(--cat-vulnerabilities)",
  malware: "var(--cat-malware)",
  industry: "var(--cat-industry)",
  tools: "var(--cat-tools)",
  ai: "var(--cat-ai)",
};

// Categories whose cards lead with a photograph. The other four
// (vulnerabilities, malware, industry, ai) use typography-forward hero
// elements (CVSS score / threat-actor name / entity / provider) because
// the AI pipeline's featured_image coverage is effectively zero.
const PHOTO_FORWARD: readonly string[] = ["threat-intel", "tools"];

export const revalidate = 3600;

export async function generateStaticParams() {
  const locales = ["en", "zh"];
  const categories = CategoryEnum.options;
  return locales.flatMap((locale) =>
    categories.map((category) => ({ locale, category })),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, category } = await params;
  const t = await getTranslations({ locale, namespace: "categories" });

  const label = CategoryEnum.options.includes(category as never)
    ? t(category as Parameters<typeof t>[0])
    : category;
  const isZh = locale === "zh";
  const description = isZh
    ? `浏览 ZCyberNews 上所有${label}文章。`
    : `Browse all ${label} articles on ZCyberNews.`;

  return {
    title: label,
    description,
    alternates: {
      canonical: `/${locale}/categories/${category}`,
      languages: {
        en: `/en/categories/${category}`,
        "zh-Hans": `/zh/categories/${category}`,
        "x-default": `/en/categories/${category}`,
      },
    },
    openGraph: {
      title: label,
      description,
      url: `/${locale}/categories/${category}`,
      siteName: "ZCyberNews",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      type: "website",
      images: [
        {
          url: getCategoryDefaultImage(category) ?? "/og-default.png",
          width: 1200,
          height: 630,
          alt: label,
        },
      ],
    },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { locale, category } = await params;

  const parsed = CategoryEnum.safeParse(category);
  if (!parsed.success) notFound();

  const t = await getTranslations({ locale, namespace: "categories" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const allPosts = getAllPosts(locale, "posts").filter(isPublicArticle);
  const tiPosts = getAllPosts(locale, "threat-intel").filter(isPublicArticle);
  const combined = [...allPosts, ...tiPosts].filter(
    (a) => a.frontmatter.category === category,
  );

  combined.sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() -
      new Date(a.frontmatter.date).getTime(),
  );

  const allCategories = [
    ...allPosts.reduce(
      (acc, article) => {
        const existing = acc.find(
          (x) => x.category === article.frontmatter.category,
        );
        if (existing) existing.count += 1;
        else acc.push({ category: article.frontmatter.category, count: 1 });
        return acc;
      },
      [] as { category: string; count: number }[],
    ),
    ...tiPosts.reduce(
      (acc, article) => {
        const existing = acc.find(
          (x) => x.category === article.frontmatter.category,
        );
        if (existing) existing.count += 1;
        else acc.push({ category: article.frontmatter.category, count: 1 });
        return acc;
      },
      [] as { category: string; count: number }[],
    ),
  ].reduce(
    (acc, { category: cat, count }) => {
      const existing = acc.find((x) => x.category === cat);
      if (existing) existing.count += count;
      else acc.push({ category: cat, count });
      return acc;
    },
    [] as { category: string; count: number }[],
  );

  const label = t(category as Parameters<typeof t>[0]);
  const catColor = CATEGORY_HSL[category] ?? "var(--primary)";
  const isPhotoForward = PHOTO_FORWARD.includes(category);
  const localeTyped = (locale === "zh" ? "zh" : "en") as "en" | "zh";

  // Pick the right card per category. threat-intel and tools use
  // ArticleCard (photo-forward). vulns/malware/industry/ai use their
  // typography-forward variants from components/home/typography-cards.tsx.
  const renderCard = (article: (typeof combined)[number]) => {
    const sourceType: "posts" | "threat-intel" =
      article.frontmatter.category === "threat-intel"
        ? "threat-intel"
        : "posts";

    if (category === "vulnerabilities") {
      return (
        <VulnCard
          key={article.frontmatter.slug}
          article={article}
          locale={localeTyped}
          sourceType={sourceType}
        />
      );
    }
    if (category === "malware") {
      return (
        <MalwareCard
          key={article.frontmatter.slug}
          article={article}
          locale={localeTyped}
          sourceType={sourceType}
        />
      );
    }
    if (category === "industry") {
      return (
        <IndustryCard
          key={article.frontmatter.slug}
          article={article}
          locale={localeTyped}
          sourceType={sourceType}
        />
      );
    }
    if (category === "ai") {
      return (
        <AICard
          key={article.frontmatter.slug}
          article={article}
          locale={localeTyped}
          sourceType={sourceType}
        />
      );
    }
    // threat-intel + tools — keep photo-forward ArticleCard
    return (
      <ArticleCard
        key={article.frontmatter.slug}
        article={article}
        locale={locale}
        type={sourceType}
      />
    );
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
      <Breadcrumbs
        items={[
          { label: locale === "zh" ? "首页" : "Home", href: `/${locale}` },
          { label: tNav("categories"), href: `/${locale}/categories` },
          { label },
        ]}
      />

      {/* NYT-style section header — accent bar + serif uppercase headline,
          matches the homepage CategorySection but scaled larger for a
          dedicated landing page. */}
      <header className="flex items-end justify-between gap-4 mb-8 sm:mb-10 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <span
            className="h-10 sm:h-12 w-1.5 rounded-sm"
            style={{ backgroundColor: `hsl(${catColor})` }}
            aria-hidden
          />
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold uppercase tracking-tight text-foreground leading-none">
              {label}
            </h1>
            <p className="mt-2 text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
              {combined.length}{" "}
              {locale === "zh"
                ? "篇文章"
                : combined.length === 1
                  ? "article"
                  : "articles"}
            </p>
          </div>
        </div>
      </header>

      {/* Category rail — horizontal scroll on mobile, inline on desktop.
          Replaces the old sidebar; reads top-of-page like NYT section
          tabs. */}
      <nav
        aria-label={tNav("categories")}
        className="flex gap-1.5 overflow-x-auto scrollbar-thin pb-4 mb-8 border-b border-border/60"
      >
        {allCategories.map(({ category: cat, count }) => {
          const isActive = cat === category;
          const chipColor = CATEGORY_HSL[cat] ?? "var(--primary)";
          return (
            <Link
              key={cat}
              href={`/categories/${cat}`}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors ${
                isActive
                  ? "bg-foreground text-background border-foreground font-medium"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: isActive
                    ? "currentColor"
                    : `hsl(${chipColor})`,
                }}
                aria-hidden
              />
              <span>{t(cat as Parameters<typeof t>[0])}</span>
              <span
                className={`font-mono tabular-nums ${isActive ? "opacity-70" : "opacity-60"}`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Article grid */}
      {combined.length === 0 ? (
        <p className="text-muted-foreground py-24 text-center font-mono">
          {"// No articles in this category yet"}
        </p>
      ) : (
        <div
          className={
            isPhotoForward
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
          }
        >
          {combined.map(renderCard)}
        </div>
      )}
    </main>
  );
}
