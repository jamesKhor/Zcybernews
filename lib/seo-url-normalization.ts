const SUPPORTED_LOCALES = new Set(["en", "zh"]);
const CANONICAL_SECTIONS = new Set(["articles", "threat-intel", "tags"]);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeSlugSegment(segment: string): string | null {
  const decoded = decodeSegment(segment);
  const normalized = decoded
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}

export function canonicalSlugForSeoVariant(segment: string): string | null {
  const normalized = normalizeSlugSegment(segment);
  if (!normalized || normalized === segment) return null;
  return normalized;
}

/**
 * Search Console has old crawl paths that differ only by URL hygiene:
 * locale-less paths, uppercase tags, `%20` spaces, or trailing hyphens from
 * truncated AI slugs. Normalize only public listing/detail routes here.
 */
export function canonicalPathForSeoVariant(
  pathname: string,
  defaultLocale = "en",
): string | null {
  const parts = pathname.split("/");
  if (parts[0] !== "") return null;

  const maybeLocale = parts[1];
  const hasLocale = SUPPORTED_LOCALES.has(maybeLocale);
  const locale = hasLocale ? maybeLocale : defaultLocale;
  const sectionIndex = hasLocale ? 2 : 1;
  const section = parts[sectionIndex];
  const slug = parts[sectionIndex + 1];

  if (
    !section ||
    !slug ||
    !CANONICAL_SECTIONS.has(section) ||
    parts.length !== sectionIndex + 2
  ) {
    return null;
  }

  const normalizedSlug = normalizeSlugSegment(slug);
  if (!normalizedSlug) return null;

  const canonicalPath = `/${locale}/${section}/${normalizedSlug}`;
  return canonicalPath === pathname ? null : canonicalPath;
}
