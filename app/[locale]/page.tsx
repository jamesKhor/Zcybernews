import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/content";
import sources from "@/data/rss-sources.json";
import { HomeJsonLd } from "@/components/seo/JsonLd";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { Hero3Col } from "@/components/home/Hero3Col";
import { MoreFromToday } from "@/components/home/MoreFromToday";
import { CategoryPillsRow } from "@/components/home/CategoryPillsRow";
import { CategorySection } from "@/components/home/CategorySection";
import {
  pickHero,
  pickTicker,
  type ArticleWithSource,
} from "@/lib/homepage-picks";

// ISR: homepage enumerates recent articles for the feed. Was hitting the
// build-time 60s timeout when run in parallel with sitemap/robots on the
// 2GB VPS. Regenerate hourly; admin publish fires revalidate to refresh.
export const revalidate = 3600;

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";
  const title = isZh
    ? "ZCyberNews — 网络安全与科技情报"
    : "ZCyberNews — Cybersecurity & Tech Intelligence";
  const description = isZh
    ? "深度威胁分析、漏洞研究与安全资讯，为防御者服务。"
    : "In-depth threat analysis, vulnerability research, and security news for defenders.";

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: { en: "/en", "zh-Hans": "/zh", "x-default": "/en" },
    },
    openGraph: {
      title,
      description,
      url: `/${locale}`,
      locale: isZh ? "zh_CN" : "en_US",
      alternateLocale: isZh ? "en_US" : "zh_CN",
      images: [
        {
          url: "/og-default.png",
          width: 1200,
          height: 630,
          alt: "ZCyberNews — Cybersecurity & Tech Intelligence",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-default.png"],
    },
  };
}

const ORDERED_CATEGORIES = [
  "threat-intel",
  "vulnerabilities",
  "malware",
  "industry",
  "tools",
  "ai",
] as const;

export default async function HomePage({ params }: Props) {
  const { locale: rawLocale } = await params;
  const locale = (rawLocale === "zh" ? "zh" : "en") as "en" | "zh";

  const postsArticles = getAllPosts(locale, "posts");
  const tiArticles = getAllPosts(locale, "threat-intel");

  // Tag each article with its source directory so URLs resolve correctly
  // (posts/ → /articles/, threat-intel/ → /threat-intel/).
  const combined: ArticleWithSource[] = [
    ...postsArticles.map((a) => ({ ...a, _sourceType: "posts" as const })),
    ...tiArticles.map((a) => ({
      ...a,
      _sourceType: "threat-intel" as const,
    })),
  ];

  // Hero picks (3 columns with differentiated selection rules)
  const hero = pickHero(combined);
  // Ticker — 5 most recent excluding hero 3
  const ticker = pickTicker(combined, hero, 5);

  // Per-category sections — each gets top 3 of its category
  // (duplication with hero is allowed by design — see spec)
  const byCategory: Record<string, ArticleWithSource[]> = {};
  for (const a of combined) {
    const cat = a.frontmatter.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(a);
  }
  // Sort each category's articles by recency
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort(
      (a, b) =>
        new Date(b.frontmatter.date).getTime() -
        new Date(a.frontmatter.date).getTime(),
    );
  }

  const hasContent = combined.length > 0;

  return (
    <main className="flex-1">
      <HomeJsonLd locale={locale} />
      {/* SEO anchor — never removed. The visible hero h2s serve the visual
          hierarchy; this sr-only h1 is the semantic site title. */}
      <h1 className="sr-only">
        {locale === "zh"
          ? "ZCyberNews — 网络安全与科技情报"
          : "ZCyberNews — Cybersecurity & Tech Intelligence"}
      </h1>

      {hasContent ? (
        <>
          <HomeGreeting locale={locale} />
          {/* Editorial hook — our selling point promoted from buried
              muted-gray strip (2026-04-22 v1) to above-the-fold
              editorial callout (2026-04-22 v2). Positioned between
              greeting and hero so readers encounter the curation
              promise BEFORE the stories themselves. Serif italic +
              left-border accent reads as an editor's note, not a
              marketing banner. */}
          <aside
            className="max-w-7xl mx-auto px-4 mt-2 mb-6"
            aria-label={locale === "zh" ? "编辑的话" : "Editor's note"}
          >
            <div className="border-l-2 border-primary/60 bg-primary/5 pl-4 pr-3 py-3 md:py-4 rounded-sm">
              <p className="font-serif text-[15px] md:text-base leading-relaxed text-foreground/90">
                {locale === "zh" ? (
                  <>
                    <span className="italic">
                      我们每天阅读 {sources.length}+
                      个网络安全信息源——只发布真正值得关注的内容。
                    </span>{" "}
                    <Link
                      href={`/${locale}/sources`}
                      className="whitespace-nowrap text-primary font-medium underline underline-offset-4 decoration-primary/40 hover:decoration-primary transition-colors"
                    >
                      查看信息来源 →
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="italic">
                      We read {sources.length}+ cybersecurity feeds every day —
                      and publish only what matters.
                    </span>{" "}
                    <Link
                      href={`/${locale}/sources`}
                      className="whitespace-nowrap text-primary font-medium underline underline-offset-4 decoration-primary/40 hover:decoration-primary transition-colors"
                    >
                      See our sources →
                    </Link>
                  </>
                )}
              </p>
            </div>
          </aside>
          <Hero3Col picks={hero} locale={locale} />
          <MoreFromToday articles={ticker} locale={locale} />
          <CategoryPillsRow locale={locale} />

          {ORDERED_CATEGORIES.filter(
            (cat) => (byCategory[cat]?.length ?? 0) > 0,
          ).map((cat) => {
            // Determine source type per category — this is imprecise
            // because a "posts" article can have category "threat-intel"
            // and vice versa. Use the sourceType of the FIRST article
            // in each category's list, since it determines the URL path.
            const firstArticle = byCategory[cat][0];
            const sourceType = firstArticle._sourceType;
            return (
              <CategorySection
                key={cat}
                category={cat}
                articles={byCategory[cat].slice(0, 3)}
                locale={locale}
                sourceType={sourceType}
              />
            );
          })}
        </>
      ) : (
        <div className="max-w-7xl mx-auto px-4 py-24 text-center text-muted-foreground">
          <p className="font-mono text-xl">{"// No articles yet"}</p>
          <p className="mt-2 text-sm">
            {locale === "zh"
              ? "通过管理面板发布第一篇文章"
              : "Publish your first article from the admin panel"}
          </p>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-10">
        <SubscribeForm />
      </div>
    </main>
  );
}
