const PRODUCTION_SITE_URL = "https://zcybernews.com";
const CANONICAL_HOST = "zcybernews.com";

/**
 * Return the canonical public site origin.
 *
 * This is intentionally small and dependency-free because it runs in
 * metadata, sitemap, robots, JSON-LD, and script contexts. It normalizes the
 * common env mistakes that split Search Console signals: www host, pathful
 * values, query strings, hashes, and trailing slashes.
 */
export function getSiteUrl(raw = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!raw) return PRODUCTION_SITE_URL;

  try {
    const url = new URL(raw);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return PRODUCTION_SITE_URL;
  }
}

export function absoluteSitePath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${normalizedPath}`;
}
