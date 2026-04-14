import type { MetadataRoute } from "next";

// robots.txt contents are static — fully static-optimized, no data loading.
// (Previously had force-dynamic but that was an over-correction; robots.ts
// doesn't enumerate content, so pre-rendering is trivial.)

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
