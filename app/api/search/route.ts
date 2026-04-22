import { NextRequest, NextResponse } from "next/server";
import { getAllPosts } from "@/lib/content";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { articleUrl } from "@/lib/article-url";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIp(req.headers);
  const rl = rateLimit(`search:${ip}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  // Narrow to the helper's accepted locales. Preserves the pre-existing
  // silent-fallback-to-"en" behavior for unrecognized values; an invalid-
  // locale → 400 response would be a behavior change, tracked separately.
  const localeParam = searchParams.get("locale");
  const locale: "en" | "zh" = localeParam === "zh" ? "zh" : "en";

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const terms = q.split(/\s+/).filter(Boolean);

  const posts = getAllPosts(locale, "posts");
  const ti = getAllPosts(locale, "threat-intel");
  const all = [
    ...posts.map((a) => ({ ...a, type: "posts" as const })),
    ...ti.map((a) => ({ ...a, type: "threat-intel" as const })),
  ];

  const scored = all
    .map((article) => {
      const { frontmatter } = article;
      const titleLower = frontmatter.title.toLowerCase();
      const excerptLower = frontmatter.excerpt.toLowerCase();
      const tagsLower = frontmatter.tags.join(" ").toLowerCase();
      const categoryLower = frontmatter.category.toLowerCase();
      const contentLower = article.content.toLowerCase().slice(0, 2000);

      let score = 0;
      for (const term of terms) {
        // Title match is weighted most heavily
        if (titleLower.includes(term)) score += 10;
        if (tagsLower.includes(term)) score += 5;
        if (categoryLower.includes(term)) score += 4;
        if (excerptLower.includes(term)) score += 3;
        if (contentLower.includes(term)) score += 1;
      }
      return { article, score, type: article.type };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const results = scored.map(({ article, type }) => {
    const { frontmatter } = article;

    // Build a short excerpt snippet highlighting the query
    const excerptText = frontmatter.excerpt;
    // URL construction delegated to lib/article-url (Phase B.3).
    // `type` here is the article SECTION, which the helper maps to the
    // URL segment internally (posts → /articles/, threat-intel →
    // /threat-intel/).
    const url = articleUrl({ slug: frontmatter.slug }, locale, type);

    return {
      title: frontmatter.title,
      slug: frontmatter.slug,
      excerpt: excerptText,
      category: frontmatter.category,
      date: frontmatter.date,
      tags: frontmatter.tags,
      type,
      url,
    };
  });

  return NextResponse.json({ results });
}
