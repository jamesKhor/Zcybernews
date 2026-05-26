import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Radar } from "lucide-react";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import type { ArticleLocale } from "@/lib/article-url";
import {
  getPublicTopicHubDefinitions,
  getTopicHubCandidates,
  getTopicHubDefinition,
  isPublicTopicHub,
  selectTopicHubArticles,
  topicHubUrl,
} from "@/lib/topic-hubs";
import { canonicalSlugForSeoVariant } from "@/lib/seo-url-normalization";

interface Props {
  params: Promise<{ locale: string; hub: string }>;
}

export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const locales: ArticleLocale[] = ["en", "zh"];
  const params: { locale: string; hub: string }[] = [];

  for (const locale of locales) {
    for (const hub of getPublicTopicHubDefinitions(locale)) {
      params.push({ locale, hub: hub.slug });
    }
  }

  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, hub: rawHub } = await params;
  const locale: ArticleLocale = rawLocale === "zh" ? "zh" : "en";
  const hub = getTopicHubDefinition(rawHub);
  if (!hub) return {};

  const candidates = getTopicHubCandidates(locale);
  const isPublic = isPublicTopicHub(hub.slug, candidates);
  const canonical = topicHubUrl(hub.slug, locale);

  return {
    title: `${hub.label[locale]} - ZCyberNews`,
    description: hub.description[locale],
    alternates: {
      canonical,
      languages: {
        en: topicHubUrl(hub.slug, "en"),
        "zh-Hans": topicHubUrl(hub.slug, "zh"),
        "x-default": topicHubUrl(hub.slug, "en"),
      },
    },
    openGraph: {
      title: `${hub.label[locale]} - ZCyberNews`,
      description: hub.description[locale],
      url: canonical,
      siteName: "ZCyberNews",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      type: "website",
    },
    ...(!isPublic && { robots: { index: false, follow: true } }),
  };
}

export default async function TopicHubPage({ params }: Props) {
  const { locale: rawLocale, hub: rawHub } = await params;
  const locale: ArticleLocale = rawLocale === "zh" ? "zh" : "en";
  const canonicalHub = canonicalSlugForSeoVariant(rawHub) ?? rawHub;
  if (canonicalHub !== rawHub) {
    const canonicalDefinition = getTopicHubDefinition(canonicalHub);
    if (!canonicalDefinition) notFound();
    permanentRedirect(topicHubUrl(canonicalDefinition.slug, locale));
  }

  const hub = getTopicHubDefinition(canonicalHub);
  if (!hub) notFound();

  const candidates = getTopicHubCandidates(locale);
  if (!isPublicTopicHub(hub.slug, candidates)) notFound();

  const articles = selectTopicHubArticles(hub.slug, candidates);
  const relatedHubs = getPublicTopicHubDefinitions(locale)
    .filter((item) => item.slug !== hub.slug)
    .slice(0, 7);
  const tNav = await getTranslations({ locale, namespace: "nav" });

  return (
    <main className="max-w-7xl mx-auto px-4 py-12">
      <Breadcrumbs
        items={[
          { label: locale === "zh" ? "首页" : "Home", href: `/${locale}` },
          { label: tNav("articles"), href: `/${locale}/articles` },
          { label: hub.label[locale] },
        ]}
      />

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Radar className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">{hub.label[locale]}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {articles.length}{" "}
              {locale === "zh"
                ? "篇文章"
                : articles.length === 1
                  ? "article"
                  : "articles"}
            </p>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
          {hub.description[locale]}
        </p>
      </header>

      {relatedHubs.length > 0 && (
        <nav className="mb-8 flex flex-wrap gap-2" aria-label="Related topics">
          {relatedHubs.map((item) => (
            <a
              key={item.slug}
              href={topicHubUrl(item.slug, locale)}
              className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              {item.label[locale]}
            </a>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {articles.map((item) => (
          <ArticleCard
            key={`${item.section}:${item.article.frontmatter.slug}`}
            article={item.article}
            locale={locale}
            type={item.section}
          />
        ))}
      </div>

      <div className="mt-16">
        <SubscribeForm />
      </div>
    </main>
  );
}
