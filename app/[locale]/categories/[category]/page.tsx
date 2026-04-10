import { getAllPosts, getAllCategories } from "@/lib/content";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CategoryEnum } from "@/lib/types";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Shield } from "lucide-react";

interface Props {
  params: Promise<{ locale: string; category: string }>;
}

const CATEGORY_ICONS: Record<string, string> = {
  "threat-intel": "🛡️",
  vulnerabilities: "🔓",
  malware: "🦠",
  industry: "🏭",
  tools: "🔧",
  ai: "🤖",
};

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

  const label =
    category in (t as unknown as Record<string, string>)
      ? t(category as Parameters<typeof t>[0])
      : category;

  return {
    title: `${label} — AleCyberNews`,
    description: `Browse all ${label} articles on AleCyberNews.`,
    alternates: {
      canonical: `/${locale}/categories/${category}`,
      languages: {
        en: `/en/categories/${category}`,
        "zh-Hans": `/zh/categories/${category}`,
      },
    },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { locale, category } = await params;

  // Validate category
  const parsed = CategoryEnum.safeParse(category);
  if (!parsed.success) notFound();

  const t = await getTranslations({ locale, namespace: "categories" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const allPosts = getAllPosts(locale, "posts");
  const tiPosts = getAllPosts(locale, "threat-intel");
  const combined = [...allPosts, ...tiPosts].filter(
    (a) => a.frontmatter.category === category,
  );

  // Sort by date descending
  combined.sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() -
      new Date(a.frontmatter.date).getTime(),
  );

  const allCategories = [
    ...getAllCategories(locale, "posts"),
    ...getAllCategories(locale, "threat-intel"),
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
  const icon = CATEGORY_ICONS[category] ?? "📁";

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
          <span className="text-4xl">{icon}</span>
          <div>
            <h1 className="text-3xl font-bold">{label}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {combined.length} {combined.length === 1 ? "article" : "articles"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sidebar — all categories */}
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {tNav("categories")}
            </p>
            <nav className="space-y-1">
              {allCategories.map(({ category: cat, count }) => {
                const isActive = cat === category;
                return (
                  <Link
                    key={cat}
                    href={`/categories/${cat}`}
                    className={`flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{CATEGORY_ICONS[cat] ?? "📁"}</span>
                      {t(cat as Parameters<typeof t>[0])}
                    </span>
                    <span
                      className={`text-xs rounded-full px-1.5 py-0.5 ${isActive ? "bg-primary/20" : "bg-secondary"}`}
                    >
                      {count}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Article grid */}
        <div className="flex-1 min-w-0">
          {combined.length === 0 ? (
            <p className="text-muted-foreground py-24 text-center font-mono">
              {"// No articles in this category yet"}
            </p>
          ) : (
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
          )}
        </div>
      </div>
    </main>
  );
}
