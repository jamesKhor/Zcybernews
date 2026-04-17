import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPostBySlug, getRecentSlugs, getRelatedPosts } from "@/lib/content";
import { compileMDX } from "@/lib/mdx";
import { ArticleMeta } from "@/components/articles/ArticleMeta";
import { IOCTable } from "@/components/threat-intel/IOCTable";
import { MitreMatrix } from "@/components/threat-intel/MitreMatrix";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { NewsArticleJsonLd, BreadcrumbJsonLd } from "@/components/seo/JsonLd";
import { CommunityCTA } from "@/components/community/CommunityCTA";
import { CATEGORY_DEFAULT_IMAGES, type Category } from "@/lib/types";
import { useTranslations } from "next-intl";
import { stripMarkdown } from "@/lib/utils";
import Image from "next/image";
import NextLink from "next/link";
import { CVEArticleBody } from "@/components/cve/CVEArticleBody";
import { SidebarAd, InArticleAd } from "@/components/ads/AdSense";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

// ISR config — pages are cached as static HTML for 1 hour, then regenerate
// on next visitor. The admin publish flow calls revalidatePath() after
// committing, so new articles appear within seconds without a full rebuild.
export const revalidate = 3600;

// Allow slugs not in generateStaticParams to render on-demand (ISR new pages).
// Without this, a newly-published article returns 404 until the next rebuild.
export const dynamicParams = true;

// Pre-render only the most recent N articles per locale at build time.
// Older articles render on first request and are cached thereafter. Keeps
// build time bounded as the article count grows.
const PRERENDER_LIMIT = 50;

export async function generateStaticParams() {
  const locales = ["en", "zh"];
  const params: { locale: string; slug: string }[] = [];

  for (const locale of locales) {
    const slugs = getRecentSlugs(locale, "posts", PRERENDER_LIMIT);
    slugs.forEach((slug) => params.push({ locale, slug }));
  }

  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const article = getPostBySlug(locale, "posts", slug);
  if (!article) return {};

  const { frontmatter } = article;
  const image =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];
  const canonical = `/${locale}/articles/${slug}`;

  return {
    title: frontmatter.title,
    description: frontmatter.excerpt,
    keywords: frontmatter.tags,
    authors: [{ name: frontmatter.author ?? "ZCyberNews" }],
    alternates: {
      canonical,
      languages: frontmatter.locale_pair
        ? {
            en:
              locale === "en"
                ? `/en/articles/${slug}`
                : `/en/articles/${frontmatter.locale_pair}`,
            "zh-Hans":
              locale === "zh"
                ? `/zh/articles/${slug}`
                : `/zh/articles/${frontmatter.locale_pair}`,
            "x-default":
              locale === "en"
                ? `/en/articles/${slug}`
                : `/en/articles/${frontmatter.locale_pair}`,
          }
        : {
            en: `/en/articles/${slug}`,
            "zh-Hans": `/zh/articles/${slug}`,
            "x-default": `/en/articles/${slug}`,
          },
    },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.excerpt,
      type: "article",
      url: canonical,
      publishedTime: frontmatter.date,
      modifiedTime: frontmatter.updated ?? frontmatter.date,
      authors: [frontmatter.author ?? "ZCyberNews"],
      tags: frontmatter.tags,
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

export default async function ArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  const article = getPostBySlug(locale, "posts", slug);
  if (!article) notFound();

  const { frontmatter, content, readingTime } = article;
  // stripReferences: ## References list is for internal admin review only,
  // not for end-readers. The source_urls frontmatter field still exists
  // on disk for admin traceability.
  const { content: mdxContent, headings } = await compileMDX(content, {
    stripReferences: true,
  });
  const related = getRelatedPosts(frontmatter, locale, "posts", 3);
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
        url={`${siteUrl}/${locale}/articles/${slug}`}
        image={image ? `${siteUrl}${image}` : undefined}
        keywords={frontmatter.tags}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `${siteUrl}/${locale}` },
          { name: "Articles", url: `${siteUrl}/${locale}/articles` },
          {
            name: frontmatter.title,
            url: `${siteUrl}/${locale}/articles/${slug}`,
          },
        ]}
      />
      <ArticlePageContent
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

function ArticlePageContent({
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
            label: locale === "zh" ? "文章" : "Articles",
            href: `/${locale}/articles`,
          },
          { label: frontmatter.title },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-12">
        {/* Main article column */}
        <article>
          {/* Header */}
          <header className="mb-8">
            <ArticleMeta
              frontmatter={frontmatter}
              readingTime={readingTime}
              locale={locale}
            />
            <h1 className="text-3xl md:text-4xl font-bold leading-tight mt-4 mb-4">
              {frontmatter.title}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {stripMarkdown(frontmatter.excerpt)}
            </p>
          </header>

          {/* Hero image */}
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

          {/* Threat Intel structured data (before body) */}
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

          {/* MDX body — CVEArticleBody hydrates plain-text CVE mentions */}
          <CVEArticleBody>{mdxContent}</CVEArticleBody>

          {/* In-article ad */}
          <InArticleAd className="my-8" />

          {/* Community CTA — renders null until Discord/WeChat env vars set */}
          <CommunityCTA variant="full" locale={locale} />

          {/* Tags */}
          {frontmatter.tags.length > 0 && (
            <div className="mt-10 pt-6 border-t border-border">
              <span className="text-sm text-muted-foreground mr-2">
                {t("tags")}:
              </span>
              {frontmatter.tags.map((tag) => (
                <NextLink
                  key={tag}
                  href={`/${locale}/tags/${encodeURIComponent(tag)}`}
                  className="inline-block mr-2 mb-1 text-sm rounded-full bg-secondary hover:bg-secondary/80 px-3 py-1 transition-colors"
                >
                  #{tag}
                </NextLink>
              ))}
            </div>
          )}
        </article>

        {/* Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            {/* Sidebar Ad */}
            <SidebarAd className="rounded-lg border border-border bg-card p-3 overflow-hidden" />

            {/* Table of Contents */}
            {headings.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-5">
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
          </div>
        </aside>
      </div>

      {/* Related articles */}
      {related.length > 0 && (
        <section className="mt-16 pt-10 border-t border-border">
          <h2 className="text-2xl font-bold mb-6">{t("relatedArticles")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {related.map((post) => (
              <ArticleCard
                key={post.frontmatter.slug}
                article={post}
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
