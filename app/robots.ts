import type { MetadataRoute } from "next";

// Skip build-time prerendering. Cheap to generate on first request + cache.
export const dynamic = "force-dynamic";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/admin/", "/api/cve/", "/api/search/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
