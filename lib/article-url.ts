/**
 * Article URL helpers — Single Source of Truth for article path shape.
 *
 * Phase B.3 of the migration sequence described in
 * `docs/pipeline-contracts-2026-04-22.md` §9. Vincent's Q4 resolution:
 * two functions — `articleUrl()` returns the path, `absoluteArticleUrl()`
 * returns the full URL.
 *
 * **Why centralize this.** There are 6+ call-sites across the codebase
 * that hand-build article URLs — sitemap, article detail pages,
 * Discord notifier, WeChat feed, search API, and the `proxy.ts` locale
 * middleware. If any one of them drifts from the canonical shape we
 * get 404s, broken canonicals, or cross-section cross-linking that
 * Google treats as a redirect chain. The helper collapses that risk
 * into one place with exhaustive unit tests.
 *
 * **Section-to-segment mapping is NOT identity.**
 *   posts       → /articles/<slug>
 *   threat-intel → /threat-intel/<slug>
 *
 * The `posts` rename is the single-largest cause of bugs in hand-built
 * URLs — every new site I've seen gets this wrong once. Map it here,
 * test it, let callers stop thinking about it.
 *
 * **Not in scope for this PR:**
 *   - Refactoring the 6 existing call-sites to use this helper (B.4+).
 *   - Locale-pair resolution for hreflang alternates (caller's job:
 *     pass `{ slug: article.locale_pair ?? article.slug }`).
 *   - Query strings or hash fragments (use URL class downstream).
 *
 * This module is PURE: no fs, network, console, process.env reads
 * beyond the explicit opt-in `absoluteArticleUrl()` baseUrl default.
 */

// ─── Types ────────────────────────────────────────────────────────────

/** Locale gate — Cycle 1 supports EN and ZH only. */
export type ArticleLocale = "en" | "zh";

/**
 * Article SECTION — the directory under `content/<locale>/` the file
 * lives in. Note this is NOT the URL segment (see SECTION_TO_SEGMENT).
 * "posts" is the generic article bucket; "threat-intel" is the
 * IOC/TTP-heavy long-form bucket with its own landing page.
 */
export type ArticleSection = "posts" | "threat-intel";

/**
 * Minimum shape needed to build a URL. Accepts the existing
 * `Article["frontmatter"]` (which has `slug: string`) as well as any
 * ad-hoc `{ slug }` object a caller constructs from a sitemap entry,
 * a search hit, or a Discord payload.
 */
export interface ArticleUrlInput {
  slug: string;
}

// ─── Constants ────────────────────────────────────────────────────────

/**
 * The rename that bites everyone. Exported so tests (and debuggers)
 * can introspect the mapping without duplicating it.
 */
export const SECTION_TO_SEGMENT: Record<ArticleSection, string> = {
  posts: "articles",
  "threat-intel": "threat-intel",
};

const DEFAULT_BASE_URL = "https://zcybernews.com";

// ─── Helpers (internal) ───────────────────────────────────────────────

function normalizeSlug(slug: string): string {
  // Strip one leading and one trailing slash; reject after that if
  // the string is empty or still contains path separators. A slug
  // with embedded "/" is almost always a caller bug — forwarding it
  // silently would produce a working URL that points to the wrong
  // route and pass a grep.
  const trimmed = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw new Error(
      `articleUrl: slug is empty (after trim) — received ${JSON.stringify(slug)}`,
    );
  }
  if (trimmed.includes("/")) {
    throw new Error(
      `articleUrl: slug contains path separator — received ${JSON.stringify(slug)}. ` +
        `Did you pass the full path instead of just the slug?`,
    );
  }
  return trimmed;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Returns the site-root-relative path for an article.
 *
 * @example
 *   articleUrl({ slug: "krebs-breach" }, "en", "posts")
 *   // "/en/articles/krebs-breach"
 *
 *   articleUrl({ slug: "apt29-campaign" }, "zh", "threat-intel")
 *   // "/zh/threat-intel/apt29-campaign"
 *
 * For hreflang alternates, resolve the alternate slug before calling:
 * @example
 *   articleUrl(
 *     { slug: article.frontmatter.locale_pair ?? article.frontmatter.slug },
 *     otherLocale,
 *     section,
 *   )
 */
export function articleUrl(
  article: ArticleUrlInput,
  locale: ArticleLocale,
  section: ArticleSection,
): string {
  const slug = normalizeSlug(article.slug);
  const segment = SECTION_TO_SEGMENT[section];
  return `/${locale}/${segment}/${slug}`;
}

/**
 * Returns the absolute URL for an article, honoring `baseUrl` override
 * or `NEXT_PUBLIC_SITE_URL` env, falling back to the production
 * default.
 *
 * Why the fallback exists: this helper runs in build/SSR contexts
 * where the env may not be set (local smoke tests, tsx scripts, etc.).
 * Hard-failing would make the helper unusable outside the Next.js
 * runtime; silent empty prefix would produce a broken absolute URL
 * that still passes a string match. The production default is the
 * safest middle ground.
 *
 * @example
 *   absoluteArticleUrl({ slug: "foo" }, "en", "posts")
 *   // "https://zcybernews.com/en/articles/foo"
 *
 *   absoluteArticleUrl({ slug: "foo" }, "en", "posts", "http://localhost:3000")
 *   // "http://localhost:3000/en/articles/foo"
 */
export function absoluteArticleUrl(
  article: ArticleUrlInput,
  locale: ArticleLocale,
  section: ArticleSection,
  baseUrl?: string,
): string {
  const base = stripTrailingSlash(
    baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_BASE_URL,
  );
  return `${base}${articleUrl(article, locale, section)}`;
}
