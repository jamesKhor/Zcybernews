import { getAllPosts } from "@/lib/content";
import { NextResponse } from "next/server";

export const revalidate = 3600;

export async function GET() {
  const posts = getAllPosts("en", "posts");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const items = posts
    .slice(0, 20)
    .map(
      (p) => `
    <item>
      <title><![CDATA[${p.frontmatter.title}]]></title>
      <link>${siteUrl}/en/articles/${p.frontmatter.slug}</link>
      <guid isPermaLink="true">${siteUrl}/en/articles/${p.frontmatter.slug}</guid>
      <description><![CDATA[${p.frontmatter.excerpt}]]></description>
      <pubDate>${new Date(p.frontmatter.date).toUTCString()}</pubDate>
      <category>${p.frontmatter.category}</category>
    </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ZCyberNews</title>
    <link>${siteUrl}</link>
    <description>Professional cybersecurity and tech intelligence</description>
    <language>en-us</language>
    <atom:link href="${siteUrl}/api/feed" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
