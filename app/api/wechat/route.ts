import { absoluteArticleUrl, type ArticleLocale } from "@/lib/article-url";
import { selectFeedArticles, type FeedIndex } from "@/lib/feed-index";
import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

export const revalidate = 3600;

const FEED_INDEX_PATH = path.join(process.cwd(), "data", "feed-index.json");

function loadFeedIndex(): FeedIndex {
  return JSON.parse(fs.readFileSync(FEED_INDEX_PATH, "utf-8")) as FeedIndex;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const locale: ArticleLocale =
    searchParams.get("locale") === "en" ? "en" : "zh";

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const posts = selectFeedArticles(loadFeedIndex().articles, locale)
    .filter((article) => article.section === "posts")
    .slice(0, 10);

  const feed = posts.map((article) => ({
    title: article.title,
    digest: article.excerpt,
    // URL construction via lib/article-url (Phase B.3). Passing
    // `siteUrl` explicitly preserves this route's historical
    // localhost-dev fallback — the helper's default would be the
    // production URL, which would incorrectly appear in dev feeds.
    content_source_url: absoluteArticleUrl(
      { slug: article.slug },
      locale,
      "posts",
      siteUrl,
    ),
    author: article.author,
    date: article.date,
    category: article.category,
    tags: article.tags,
    severity: article.severity,
    threat_actor: article.threat_actor,
  }));

  return NextResponse.json(
    { locale, total: feed.length, articles: feed },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
