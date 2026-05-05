import type { Metadata } from "next";
import { getAllPosts } from "@/lib/content";
import { isPublicArticle } from "@/lib/publication";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { InFeedAd } from "@/components/ads/AdSense";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { useTranslations } from "next-intl";

const PAGE_SIZE = 12;

export const revalidate = 3600;

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; category?: string; tag?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { locale } = await params;
  const { page: pageParam } = await searchParams;
  const page = parseInt(pageParam ?? "1", 10) || 1;
  const isZh = locale === "zh";
  const title = isZh ? "文章" : "Articles";
  const description = isZh
    ? "浏览所有网络安全文章、分析与研究报告。"
    : "Browse all cybersecurity articles, analysis, and research.";
  // Pages beyond 1 get self-referencing canonical to avoid duplicate content
  const canonical =
    page > 1 ? `/${locale}/articles?page=${page}` : `/${locale}/articles`;
  return {
    title: page > 1 ? `${title} — ${isZh ? "第" : "Page "}${page}` : title,
    description,
    alternates: {
      canonical,
      languages: {
        en: "/en/articles",
        "zh-Hans": "/zh/articles",
        "x-default": "/en/articles",
      },
    },
    openGraph: { title, description, url: `/${locale}/articles` },
    twitter: { card: "summary_large_image", title, description },
    ...(page > 1 && { robots: { index: false } }),
  };
}

export default async function ArticlesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { page: pageParam, category, tag } = await searchParams;

  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const allPosts = getAllPosts(locale, "posts").filter(isPublicArticle);

  const filtered = allPosts.filter((a) => {
    if (category && a.frontmatter.category !== category) return false;
    if (tag && !a.frontmatter.tags.includes(tag)) return false;
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const posts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <ArticlesContent
      locale={locale}
      posts={posts}
      page={page}
      totalPages={totalPages}
      total={total}
      activeCategory={category}
      activeTag={tag}
    />
  );
}

function ArticlesContent({
  locale,
  posts,
  page,
  totalPages,
  total,
  activeCategory,
  activeTag,
}: {
  locale: string;
  posts: ReturnType<typeof getAllPosts>;
  page: number;
  totalPages: number;
  total: number;
  activeCategory?: string;
  activeTag?: string;
}) {
  const t = useTranslations("nav");

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <Breadcrumbs
        items={[
          { label: t("home"), href: `/${locale}` },
          { label: t("articles") },
        ]}
      />
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2">{t("articles")}</h1>
        <p className="text-muted-foreground text-sm">{total} articles</p>
        {(activeCategory || activeTag) && (
          <div className="mt-3 flex gap-2 text-sm">
            {activeCategory && (
              <span className="rounded-full bg-primary/10 text-primary px-3 py-1">
                {activeCategory}
              </span>
            )}
            {activeTag && (
              <span className="rounded-full bg-secondary text-secondary-foreground px-3 py-1">
                #{activeTag}
              </span>
            )}
          </div>
        )}
      </div>

      {posts.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center font-mono">
          {"// No articles found"}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post, i) => (
            <div key={post.frontmatter.slug}>
              <ArticleCard article={post} locale={locale} />
              {/* In-feed ad after 3rd card */}
              {i === 2 && <InFeedAd className="mt-6" />}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <PaginationNav
          locale={locale}
          page={page}
          totalPages={totalPages}
          category={activeCategory}
          tag={activeTag}
        />
      )}
    </main>
  );
}

function PaginationNav({
  locale,
  page,
  totalPages,
  category,
  tag,
}: {
  locale: string;
  page: number;
  totalPages: number;
  category?: string;
  tag?: string;
}) {
  function buildUrl(p: number) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (tag) params.set("tag", tag);
    params.set("page", String(p));
    return `/${locale}/articles?${params.toString()}`;
  }

  return (
    <div className="flex items-center justify-center gap-3 mt-12">
      {page > 1 && (
        <a
          href={buildUrl(page - 1)}
          className="rounded border border-border px-4 py-2 text-sm hover:bg-secondary transition-colors"
        >
          ← Prev
        </a>
      )}
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <a
          href={buildUrl(page + 1)}
          className="rounded border border-border px-4 py-2 text-sm hover:bg-secondary transition-colors"
        >
          Next →
        </a>
      )}
    </div>
  );
}
