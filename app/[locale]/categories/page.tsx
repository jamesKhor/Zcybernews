import type { Metadata } from "next";
import { getAllPosts, type Article } from "@/lib/content";
import { CategoryEnum, type Category } from "@/lib/types";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

interface Props {
  params: Promise<{ locale: string }>;
}

// Per-category hue tokens — mirrors the per-category detail page
// (app/[locale]/categories/[category]/page.tsx) so the same accent
// color identifies a category on the index, the detail page, and the
// homepage CategorySection. If you change a hue here, change it in
// those two files too, or extract to a shared module.
const CATEGORY_HSL: Record<string, string> = {
  "threat-intel": "var(--cat-threat-intel)",
  vulnerabilities: "var(--cat-vulnerabilities)",
  malware: "var(--cat-malware)",
  industry: "var(--cat-industry)",
  tools: "var(--cat-tools)",
  ai: "var(--cat-ai)",
};

export const revalidate = 3600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";
  const title = isZh ? "分类" : "Categories";
  const description = isZh
    ? "按主题浏览网络安全文章。"
    : "Browse cybersecurity articles by topic.";
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/categories`,
      languages: {
        en: "/en/categories",
        "zh-Hans": "/zh/categories",
        "x-default": "/en/categories",
      },
    },
  };
}

/**
 * Compute counts + the single most-recent article per category in one
 * pass over the combined corpus. O(n) over n articles; runs at build
 * time (SSG) for ISR, so never on request path.
 */
function computePerCategoryStats(
  posts: Article[],
  tiPosts: Article[],
): Record<string, { count: number; latest: Article | null }> {
  const out: Record<string, { count: number; latest: Article | null }> = {};
  for (const cat of CategoryEnum.options) {
    out[cat] = { count: 0, latest: null };
  }
  for (const a of [...posts, ...tiPosts]) {
    const cat = a.frontmatter.category;
    if (!out[cat]) continue;
    out[cat].count++;
    const current = out[cat].latest;
    if (
      !current ||
      new Date(a.frontmatter.date).getTime() >
        new Date(current.frontmatter.date).getTime()
    ) {
      out[cat].latest = a;
    }
  }
  return out;
}

export default async function CategoriesPage({ params }: Props) {
  const { locale } = await params;
  const posts = getAllPosts(locale, "posts");
  const tiPosts = getAllPosts(locale, "threat-intel");
  const stats = computePerCategoryStats(posts, tiPosts);

  return <CategoriesContent locale={locale} stats={stats} />;
}

function CategoriesContent({
  locale,
  stats,
}: {
  locale: string;
  stats: Record<string, { count: number; latest: Article | null }>;
}) {
  const tCats = useTranslations("categories");
  const isZh = locale === "zh";

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
      <Breadcrumbs
        items={[
          { label: isZh ? "首页" : "Home", href: `/${locale}` },
          { label: isZh ? "分类" : "Categories" },
        ]}
      />

      {/* NYT-style header — accent bar + serif uppercase. Mirrors the
          per-category detail page so arriving at this hub doesn't feel
          visually disconnected from the rest of the redesigned site. */}
      <header className="flex items-end justify-between gap-4 mb-8 sm:mb-10 pb-4 border-b border-border">
        <div className="flex items-center gap-4">
          <span
            className="h-10 sm:h-12 w-1.5 rounded-sm bg-foreground"
            aria-hidden
          />
          <div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold uppercase tracking-tight text-foreground leading-none">
              {isZh ? "分类" : "Categories"}
            </h1>
            <p className="mt-2 text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
              {isZh
                ? `六大主题 · 共 ${Object.values(stats).reduce((n, s) => n + s.count, 0)} 篇文章`
                : `6 topics · ${Object.values(stats).reduce((n, s) => n + s.count, 0)} articles`}
            </p>
          </div>
        </div>
      </header>

      {/* Category grid — each tile = accent bar (category color) + serif
          uppercase name + count + latest-article teaser. Matches the
          editorial cadence of the rest of the site. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        {CategoryEnum.options.map((cat) => {
          const color = CATEGORY_HSL[cat] ?? "var(--primary)";
          const s = stats[cat];
          const latest = s?.latest;
          const latestHref = latest
            ? latest.frontmatter.category === "threat-intel"
              ? `/threat-intel/${latest.frontmatter.slug}`
              : `/articles/${latest.frontmatter.slug}`
            : null;
          return (
            <Link
              key={cat}
              href={`/categories/${cat}` as Parameters<typeof Link>[0]["href"]}
              locale={locale as "en" | "zh"}
              className="group relative flex flex-col pl-5 pr-5 py-5 rounded-md border border-border bg-card hover:border-foreground/30 hover:bg-secondary/30 transition-colors min-h-[140px]"
            >
              {/* Accent bar — full-height stripe on the left, category hue */}
              <span
                className="absolute left-0 top-4 bottom-4 w-1 rounded-full"
                style={{ backgroundColor: `hsl(${color})` }}
                aria-hidden
              />

              {/* Header row: category name + count */}
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="font-serif text-xl sm:text-2xl font-bold uppercase tracking-tight text-foreground group-hover:text-foreground leading-none">
                  {tCats(cat as Parameters<typeof tCats>[0])}
                </h2>
                <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-muted-foreground shrink-0">
                  {s?.count ?? 0}{" "}
                  {isZh ? "篇" : s?.count === 1 ? "article" : "articles"}
                </span>
              </div>

              {/* Latest article teaser — acts as a newsy "what's here right
                  now" signal. If the category is empty, show a neutral
                  placeholder. */}
              {latest ? (
                <div className="mt-auto pt-3 border-t border-border/40">
                  <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/80 mb-1.5">
                    {isZh ? "最新" : "Latest"} ·{" "}
                    {new Date(latest.frontmatter.date).toLocaleDateString(
                      isZh ? "zh-CN" : "en-US",
                      { month: "short", day: "numeric" },
                    )}
                  </p>
                  <p className="text-sm text-foreground/85 leading-snug line-clamp-2">
                    {latest.frontmatter.title}
                  </p>
                </div>
              ) : (
                <div className="mt-auto pt-3 border-t border-border/40">
                  <p className="text-xs text-muted-foreground/70 font-mono">
                    {isZh ? "暂无文章" : "No articles yet"}
                  </p>
                </div>
              )}
              {/* Invisible helper so the card has a clickable target — the
                  Link itself covers everything but an explicit focus ring
                  helps keyboard users. Rely on the ring provided by the
                  Link component's focus-visible state. */}
              {latestHref && (
                <span className="sr-only">
                  {isZh
                    ? `查看 ${tCats(cat as Parameters<typeof tCats>[0])} 分类`
                    : `Browse ${tCats(cat as Parameters<typeof tCats>[0])}`}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
