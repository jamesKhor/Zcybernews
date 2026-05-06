import fs from "node:fs";
import path from "node:path";
import { articleUrl, type ArticleLocale } from "@/lib/article-url";
import {
  selectFeedArticles,
  type FeedIndex,
  type FeedIndexArticle,
} from "@/lib/feed-index";
import { getSiteUrl } from "@/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 600; // 10 min cache — fresher for Feedly

const FEED_INDEX_PATH = path.join(process.cwd(), "data", "feed-index.json");

function loadFeedIndex(): FeedIndex {
  return JSON.parse(fs.readFileSync(FEED_INDEX_PATH, "utf-8")) as FeedIndex;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCdata(str: string): string {
  return str.replace(/]]>/g, "]]]]><![CDATA[>");
}

/**
 * Generate a realistic publication time for articles that only have a date.
 * Staggers articles across the day (09:00, 11:00, 13:00, etc. SGT)
 * so RSS readers like Feedly show them in proper chronological order
 * instead of all at midnight UTC.
 */
function buildPubDate(dateStr: string, index: number): string {
  const base = new Date(dateStr + "T00:00:00+08:00"); // SGT midnight
  // Stagger: first article at 09:00 SGT, then every 2 hours
  const hourOffset = 9 + index * 2;
  base.setHours(base.getHours() + Math.min(hourOffset, 23));
  return base.toUTCString();
}

function buildItem(
  article: FeedIndexArticle,
  locale: ArticleLocale,
  siteUrl: string,
  indexForDate: number,
): string {
  const url = `${siteUrl}${articleUrl(
    { slug: article.slug },
    locale,
    article.section,
  )}`;

  return `
    <item>
      <title><![CDATA[${escapeCdata(article.title)}]]></title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description><![CDATA[${escapeCdata(article.excerpt)}]]></description>
      <pubDate>${buildPubDate(article.date, indexForDate)}</pubDate>
      <category>${escapeXml(article.category)}</category>
    </item>`;
}

export async function GET(request: NextRequest) {
  const locale =
    request.nextUrl.searchParams.get("locale") === "zh" ? "zh" : "en";
  const siteUrl = getSiteUrl();

  const all = selectFeedArticles(loadFeedIndex().articles, locale, 20);

  // Group articles by date so staggering resets per day
  const dateGroups = new Map<string, number>();

  const items = all
    .map((article) => {
      const idx = dateGroups.get(article.date) ?? 0;
      dateGroups.set(article.date, idx + 1);
      return buildItem(article, locale, siteUrl, idx);
    })
    .join("");

  const feedTitle = locale === "zh" ? "ZCyberNews 中文" : "ZCyberNews";
  const feedDesc =
    locale === "zh"
      ? "网络安全与科技情报"
      : "Professional cybersecurity and tech intelligence";
  const lastBuild = new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${feedTitle}</title>
    <link>${siteUrl}</link>
    <description>${feedDesc}</description>
    <language>${locale === "zh" ? "zh-cn" : "en-us"}</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <ttl>10</ttl>
    <atom:link href="${siteUrl}/api/feed${locale === "zh" ? "?locale=zh" : ""}" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
