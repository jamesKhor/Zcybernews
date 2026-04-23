import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPostBySlug, getRecentSlugs, getRelatedPosts } from "@/lib/content";
import { compileMDX } from "@/lib/mdx";
import { ArticleMeta } from "@/components/articles/ArticleMeta";
import { TldrCallout } from "@/components/articles/TldrCallout";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { IOCTable } from "@/components/threat-intel/IOCTable";
import { MitreMatrix } from "@/components/threat-intel/MitreMatrix";
import { NewsArticleJsonLd, BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { CommunityCTA } from "@/components/community/CommunityCTA";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import { CATEGORY_DEFAULT_IMAGES, type Category } from "@/lib/types";
import { useTranslations } from "next-intl";
import { CVEArticleBody } from "@/components/cve/CVEArticleBody";
import { SidebarAd, InArticleAd } from "@/components/ads/AdSense";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import Image from "next/image";
import {
  articleUrl,
  absoluteArticleUrl,
  type ArticleLocale,
} from "@/lib/article-url";

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

// ISR: pre-render recent articles, regenerate older/new ones on demand
export const revalidate = 3600;
export const dynamicParams = true;

const PRERENDER_LIMIT = 50;

export async function generateStaticParams() {
  const locales = ["en", "zh"];
  const params: { locale: string; slug: string }[] = [];
  for (const locale of locales) {
    const slugs = getRecentSlugs(locale, "threat-intel", PRERENDER_LIMIT);
    slugs.forEach((slug) => params.push({ locale, slug }));
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  // Narrow once for the URL helper — same pattern as the articles
  // detail page. See articles/[slug]/page.tsx for rationale.
  const locale: ArticleLocale = rawLocale === "zh" ? "zh" : "en";
  const article = getPostBySlug(locale, "threat-intel", slug);
  if (!article) return {};
  const { frontmatter } = article;
  const image =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];
  const canonical = articleUrl({ slug }, locale, "threat-intel");

  // Resolve alternate slugs — when locale_pair is set, the other-
  // locale URL uses the pair slug; our own URL always uses our own.
  const enSlug = locale === "en" ? slug : (frontmatter.locale_pair ?? slug);
  const zhSlug = locale === "zh" ? slug : (frontmatter.locale_pair ?? slug);

  return {
    title: frontmatter.title,
    description: frontmatter.excerpt,
    keywords: [
      ...(frontmatter.tags ?? []),
      ...(frontmatter.cve_ids ?? []),
      frontmatter.threat_actor ?? "",
    ].filter(Boolean),
    alternates: {
      canonical,
      languages: {
        en: articleUrl({ slug: enSlug }, "en", "threat-intel"),
        "zh-Hans": articleUrl({ slug: zhSlug }, "zh", "threat-intel"),
        "x-default": articleUrl({ slug: enSlug }, "en", "threat-intel"),
      },
    },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.excerpt,
      type: "article",
      url: canonical,
      publishedTime: frontmatter.date,
      modifiedTime: frontmatter.updated ?? frontmatter.date,
      locale: locale === "zh" ? "zh_CN" : "en_US",
      images: image
        ? [{ url: image, width: 1200, height: 630, alt: frontmatter.title }]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title: frontmatter.title,
      description: frontmatter.excerpt,
      images: image ? [image] : [],
    },
  };
}

export default async function ThreatIntelArticlePage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  // Same narrowing pattern as generateMetadata above.
  const locale: ArticleLocale = rawLocale === "zh" ? "zh" : "en";
  const article = getPostBySlug(locale, "threat-intel", slug);
  if (!article) notFound();

  const { frontmatter, content, readingTime } = article;
  // stripReferences: ## References list is for internal admin review only,
  // not for end-readers. The source_urls frontmatter field still exists
  // on disk for admin traceability.
  const { content: mdxContent, headings } = await compileMDX(content, {
    stripReferences: true,
  });
  const related = getRelatedPosts(frontmatter, locale, "threat-intel", 3);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";
  const image =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];

  return (
    <>
      <NewsArticleJsonLd
        headline={frontmatter.title}
        description={frontmatter.excerpt}
        datePublished={frontmatter.date}
        dateModified={frontmatter.updated}
        authorName={frontmatter.author ?? "ZCyberNews"}
        url={absoluteArticleUrl({ slug }, locale, "threat-intel", siteUrl)}
        image={image ? `${siteUrl}${image}` : undefined}
        keywords={frontmatter.tags}
      />
      <BreadcrumbJsonLd
        items={[
          {
            name: locale === "zh" ? "首页" : "Home",
            url: `${siteUrl}/${locale}`,
          },
          {
            // /threat-intel listing root is a section page, not an
            // article URL — lib/article-url is scoped to articles.
            name: locale === "zh" ? "威胁情报" : "Threat Intelligence",
            url: `${siteUrl}/${locale}/threat-intel`,
          },
          {
            name: frontmatter.title,
            url: absoluteArticleUrl({ slug }, locale, "threat-intel", siteUrl),
          },
        ]}
      />
      <TIPageContent
        frontmatter={frontmatter}
        mdxContent={mdxContent}
        headings={headings}
        readingTime={readingTime}
        related={related}
        locale={locale}
      />
    </>
  );
}

function TIPageContent({
  frontmatter,
  mdxContent,
  headings,
  readingTime,
  related,
  locale,
}: {
  frontmatter: import("@/lib/types").ArticleFrontmatter;
  mdxContent: React.ReactElement;
  headings: { id: string; text: string; level: number }[];
  readingTime: number;
  related: import("@/lib/content").Article[];
  locale: string;
}) {
  const t = useTranslations("article");
  const featuredImage =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <Breadcrumbs
        items={[
          { label: locale === "zh" ? "首页" : "Home", href: `/${locale}` },
          {
            label: locale === "zh" ? "威胁情报" : "Threat Intel",
            href: `/${locale}/threat-intel`,
          },
          { label: frontmatter.title },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-12">
        <article>
          <header className="mb-8">
            <ArticleMeta
              frontmatter={frontmatter}
              readingTime={readingTime}
              locale={locale}
            />
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mt-4 mb-4">
              {frontmatter.title}
            </h1>
            <p className="text-lg text-muted-foreground">
              {frontmatter.excerpt}
            </p>
          </header>

          {/* TLDR (B-022) — renders only when frontmatter.tldr is present. */}
          <TldrCallout tldr={frontmatter.tldr} locale={locale} />

          {featuredImage && (
            <div className="relative mb-8 rounded-lg overflow-hidden border border-border h-64">
              <Image
                src={featuredImage}
                alt={frontmatter.featured_image_alt ?? frontmatter.title}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 720px"
                className="object-cover"
              />
            </div>
          )}

          {frontmatter.iocs && frontmatter.iocs.length > 0 && (
            <div className="mb-8">
              <IOCTable iocs={frontmatter.iocs} />
            </div>
          )}

          {frontmatter.ttp_matrix && frontmatter.ttp_matrix.length > 0 && (
            <div className="mb-8">
              <MitreMatrix ttps={frontmatter.ttp_matrix} />
            </div>
          )}

          <CVEArticleBody>{mdxContent}</CVEArticleBody>

          <InArticleAd className="my-8" />

          {/* Newsletter signup — primary conversion CTA */}
          <div className="my-10">
            <SubscribeForm />
          </div>

          {/* Community CTA — renders null until Discord/WeChat env vars set */}
          <CommunityCTA variant="full" locale={locale} />
        </article>

        <aside className="hidden lg:block">
          <SidebarAd className="rounded-lg border border-border bg-card p-3 overflow-hidden mb-4" />

          {headings.length > 0 && (
            <div className="sticky top-6 rounded-lg border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-primary mb-3 uppercase tracking-wide">
                {t("tableOfContents")}
              </h3>
              <nav className="space-y-1">
                {headings.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className={`block text-sm hover:text-primary transition-colors ${
                      h.level === 2
                        ? "text-foreground"
                        : "text-muted-foreground pl-3"
                    }`}
                  >
                    {h.text}
                  </a>
                ))}
              </nav>
            </div>
          )}
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="text-2xl font-bold mb-6">{t("relatedArticles")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {related.map((post) => (
              <ArticleCard
                key={post.frontmatter.slug}
                article={post}
                locale={locale}
                type="threat-intel"
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
