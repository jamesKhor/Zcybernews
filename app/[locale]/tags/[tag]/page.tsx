import { getAllPosts, getAllTags } from "@/lib/content";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Tag } from "lucide-react";

interface Props {
  params: Promise<{ locale: string; tag: string }>;
}

export async function generateStaticParams() {
  const locales = ["en", "zh"];
  const params: { locale: string; tag: string }[] = [];
  for (const locale of locales) {
    const postTags = getAllTags(locale, "posts");
    const tiTags = getAllTags(locale, "threat-intel");
    const allTags = [...new Set([...postTags, ...tiTags])];
    allTags.forEach((tag) => params.push({ locale, tag }));
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, tag } = await params;
  return {
    title: `#${tag} — ZCyberNews`,
    description: `Browse all articles tagged with "${tag}" on ZCyberNews.`,
    alternates: {
      canonical: `/${locale}/tags/${tag}`,
      languages: {
        en: `/en/tags/${tag}`,
        "zh-Hans": `/zh/tags/${tag}`,
        "x-default": `/en/tags/${tag}`,
      },
    },
    openGraph: {
      title: `#${tag} — ZCyberNews`,
      description: `Browse all articles tagged with "${tag}" on ZCyberNews.`,
      url: `/${locale}/tags/${tag}`,
      siteName: "ZCyberNews",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      type: "website",
    },
  };
}

export default async function TagPage({ params }: Props) {
  const { locale, tag } = await params;

  const t = await getTranslations({ locale, namespace: "article" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const allPosts = getAllPosts(locale, "posts");
  const tiPosts = getAllPosts(locale, "threat-intel");
  const combined = [...allPosts, ...tiPosts].filter((a) =>
    a.frontmatter.tags.includes(tag),
  );

  if (combined.length === 0) notFound();

  combined.sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() -
      new Date(a.frontmatter.date).getTime(),
  );

  // Related tags — tags that co-occur with this one
  const relatedTagCounts = new Map<string, number>();
  for (const post of combined) {
    for (const t of post.frontmatter.tags) {
      if (t !== tag)
        relatedTagCounts.set(t, (relatedTagCounts.get(t) ?? 0) + 1);
    }
  }
  const relatedTags = Array.from(relatedTagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([t]) => t);

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      {/* Breadcrumb */}
      <div className="mb-8">
        <Link
          href="/articles"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {tNav("articles")}
        </Link>

        <div className="flex items-center gap-3">
          <Tag className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-muted-foreground">#</span>
              {tag}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {combined.length} {combined.length === 1 ? "article" : "articles"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sidebar — related tags */}
        {relatedTags.length > 0 && (
          <aside className="hidden lg:block w-52 shrink-0">
            <div className="sticky top-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                {t("tags")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {relatedTags.map((relTag) => (
                  <Link
                    key={relTag}
                    href={`/tags/${relTag}`}
                    className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    #{relTag}
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Article grid */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {combined.map((post) => (
              <ArticleCard
                key={post.frontmatter.slug}
                article={post}
                locale={locale}
                type={
                  post.frontmatter.category === "threat-intel"
                    ? "threat-intel"
                    : "posts"
                }
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
