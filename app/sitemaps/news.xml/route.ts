import { buildCurrentNewsSitemapXml } from "@/lib/news-sitemap";

export const revalidate = 3600;

export function GET(): Response {
  return new Response(buildCurrentNewsSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
