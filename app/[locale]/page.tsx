import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getAllPosts } from "@/lib/content";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { Link } from "@/i18n/navigation";
import { format } from "date-fns";
import { CATEGORY_DEFAULT_IMAGES, type Category } from "@/lib/types";
import { HomeJsonLd } from "@/components/seo/JsonLd";
import { stripMarkdown } from "@/lib/utils";

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
    title,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: { en: "/en", "zh-Hans": "/zh" },
    },
    openGraph: {
      title,
      description,
      url: `/${locale}`,
      locale: isZh ? "zh_CN" : "en_US",
      alternateLocale: isZh ? "en_US" : "zh_CN",
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

// Wrap an article with its source directory type so we can build correct URLs
type ArticleWithSource = import("@/lib/content").Article & {
  _sourceType: "posts" | "threat-intel";
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;

  const allPosts = getAllPosts(locale, "posts");
  const tiPosts = getAllPosts(locale, "threat-intel");

  // Latest: 4 most recent across all content — tagged with their source so URLs are correct
  const combined: ArticleWithSource[] = [
    ...allPosts.map((a) => ({ ...a, _sourceType: "posts" as const })),
    ...tiPosts.map((a) => ({ ...a, _sourceType: "threat-intel" as const })),
  ].sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() -
      new Date(a.frontmatter.date).getTime(),
  );
  const latest = combined.slice(0, 4);
  const latestSlugs = new Set(latest.map((a) => a.frontmatter.slug));

  // Group remaining posts by category
  const postsByCat: Record<string, typeof allPosts> = {};
  for (const post of allPosts.filter(
    (p) => !latestSlugs.has(p.frontmatter.slug),
  )) {
    const cat = post.frontmatter.category;
    if (!postsByCat[cat]) postsByCat[cat] = [];
    postsByCat[cat].push(post);
  }

  // Threat intel section (excluding already shown in latest)
  const tiRemaining = tiPosts.filter(
    (p) => !latestSlugs.has(p.frontmatter.slug),
  );

  return (
    <HomeContent
      locale={locale}
      latest={latest}
      postsByCat={postsByCat}
      tiPosts={tiRemaining.slice(0, 3)}
    />
  );
}

function HomeContent({
  locale,
  latest,
  postsByCat,
  tiPosts,
}: {
  locale: string;
  latest: ArticleWithSource[];
  postsByCat: Record<string, Awaited<ReturnType<typeof getAllPosts>>>;
  tiPosts: Awaited<ReturnType<typeof getAllPosts>>;
}) {
  const t = useTranslations("home");
  const tCats = useTranslations("categories");
  const isZh = locale === "zh";

  const hasContent =
    latest.length > 0 ||
    tiPosts.length > 0 ||
    Object.values(postsByCat).some((p) => p.length > 0);

  return (
    <main className="flex-1">
      <HomeJsonLd locale={locale} />
      {/* Breaking ticker */}
      {latest[0] && (
        <div className="border-b border-border bg-primary/5">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 min-w-0">
            <span className="flex-shrink-0 text-xs font-bold font-mono bg-destructive text-destructive-foreground px-2 py-0.5 rounded uppercase tracking-wider">
              {isZh ? "最新" : "Breaking"}
            </span>
            <Link
              href={
                `/articles/${latest[0].frontmatter.slug}` as Parameters<
                  typeof Link
                >[0]["href"]
              }
              locale={locale as "en" | "zh"}
              className="text-xs text-muted-foreground hover:text-foreground truncate transition-colors"
            >
              {latest[0].frontmatter.title}
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
        {/* Latest section */}
        {latest.length > 0 && (
          <section>
            <SectionHeader
              label={isZh ? "最新报道" : "Latest"}
              href="/articles"
              locale={locale}
              viewAll={t("viewAll")}
            />
            <LatestGrid articles={latest} locale={locale} />
          </section>
        )}

        {/* Threat Intel section */}
        {tiPosts.length > 0 && (
          <section>
            <SectionHeader
              label={isZh ? "威胁情报" : "Threat Intel"}
              href="/threat-intel"
              locale={locale}
              viewAll={t("viewAll")}
              accent="destructive"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {tiPosts.map((post) => (
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

        {/* Category sections */}
        {ORDERED_CATEGORIES.filter(
          (cat) => (postsByCat[cat]?.length ?? 0) > 0,
        ).map((cat) => (
          <section key={cat}>
            <SectionHeader
              label={tCats(cat)}
              href={`/categories/${cat}`}
              locale={locale}
              viewAll={t("viewAll")}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {postsByCat[cat].slice(0, 3).map((post) => (
                <ArticleCard
                  key={post.frontmatter.slug}
                  article={post}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        ))}

        {!hasContent && (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-xl font-mono">{"// No articles yet"}</p>
            <p className="mt-2 text-sm">
              {isZh
                ? "通过管理面板发布第一篇文章"
                : "Publish your first article from the admin panel"}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Latest grid: newspaper-style 1 big + 3 compact ─────────────────────────

function LatestGrid({
  articles,
  locale,
}: {
  articles: ArticleWithSource[];
  locale: string;
}) {
  const tCats = useTranslations("categories");
  const tArt = useTranslations("article");
  const [lead, ...rest] = articles;
  if (!lead) return null;

  // Use _sourceType (not category) so posts stored in content/posts/ always
  // link to /articles/ even when their category is "threat-intel"
  const leadHref = `/${locale}/${lead._sourceType === "threat-intel" ? "threat-intel" : "articles"}/${lead.frontmatter.slug}`;
  const leadImage =
    lead.frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[lead.frontmatter.category as Category];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* Lead story */}
      <a
        href={leadHref}
        className="lg:col-span-3 group flex flex-col rounded-xl border border-border bg-card hover:border-primary/40 transition-all duration-200 overflow-hidden"
      >
        <div className="relative h-52 bg-secondary overflow-hidden">
          {leadImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={leadImage}
              alt={
                lead.frontmatter.featured_image_alt ?? lead.frontmatter.title
              }
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-transparent" />
          )}
        </div>
        <div className="p-5 flex flex-col gap-2 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded px-2 py-0.5">
              {tCats(lead.frontmatter.category)}
            </span>
            <time
              dateTime={lead.frontmatter.date}
              className="text-xs text-muted-foreground"
            >
              {format(new Date(lead.frontmatter.date), "MMM d, yyyy")}
            </time>
          </div>
          <h2 className="text-lg font-bold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {lead.frontmatter.title}
          </h2>
          <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
            {stripMarkdown(lead.frontmatter.excerpt)}
          </p>
          <span className="text-xs text-muted-foreground">
            {tArt("readingTime", { minutes: lead.readingTime })}
          </span>
        </div>
      </a>

      {/* 3 compact stories */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        {rest.slice(0, 3).map((article) => {
          const href = `/${locale}/${article._sourceType === "threat-intel" ? "threat-intel" : "articles"}/${article.frontmatter.slug}`;
          return (
            <a
              key={article.frontmatter.slug}
              href={href}
              className="group flex gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-all duration-200"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-primary font-medium">
                    {tCats(article.frontmatter.category)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(article.frontmatter.date), "MMM d")}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                  {article.frontmatter.title}
                </h3>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({
  label,
  href,
  locale,
  viewAll,
  accent,
}: {
  label: string;
  href: string;
  locale: string;
  viewAll: string;
  accent?: "destructive" | "primary";
}) {
  return (
    <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
      <div className="flex items-center gap-2">
        <span
          className={`h-3 w-1 rounded-full ${accent === "destructive" ? "bg-destructive" : "bg-primary"}`}
        />
        <h2 className="text-base font-bold uppercase tracking-wide text-foreground">
          {label}
        </h2>
      </div>
      <Link
        href={href as Parameters<typeof Link>[0]["href"]}
        locale={locale as "en" | "zh"}
        className="text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        {viewAll} →
      </Link>
    </div>
  );
}
