import { articleUrl, type ArticleLocale } from "./article-url";
import { getAllPosts } from "./content";
import { isPublicArticle } from "./publication";

type RedirectRule = {
  source: string;
  destination: string;
  permanent: true;
};

const LOCALES: ArticleLocale[] = ["en", "zh"];

function sectionRedirectFor(
  locale: ArticleLocale,
  slug: string,
  canonicalType: "posts" | "threat-intel",
): RedirectRule {
  const sourceSection = canonicalType === "posts" ? "threat-intel" : "articles";

  return {
    source: `/${locale}/${sourceSection}/${slug}`,
    destination: articleUrl({ slug }, locale, canonicalType),
    permanent: true,
  };
}

/**
 * Build explicit 308 redirects for article slugs requested under the wrong
 * public section. Next config redirects run before filesystem routing, so
 * Google sees a real HTTP redirect instead of an App Router streamed fallback.
 */
export function buildSectionRedirects(): RedirectRule[] {
  const redirects: RedirectRule[] = [];

  for (const locale of LOCALES) {
    for (const article of getAllPosts(locale, "posts").filter(
      isPublicArticle,
    )) {
      redirects.push(
        sectionRedirectFor(locale, article.frontmatter.slug, "posts"),
      );
    }

    for (const article of getAllPosts(locale, "threat-intel").filter(
      isPublicArticle,
    )) {
      redirects.push(
        sectionRedirectFor(locale, article.frontmatter.slug, "threat-intel"),
      );
    }
  }

  return redirects;
}
