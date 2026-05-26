import type { MetadataRoute } from "next";
import { NEWS_SITEMAP_PATH } from "@/lib/sitemap-paths";
import { getSiteUrl } from "@/lib/site-url";

// robots.txt contents are static — fully static-optimized, no data loading.
// (Previously had force-dynamic but that was an over-correction; robots.ts
// doesn't enumerate content, so pre-rendering is trivial.)

const BASE_URL = getSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/admin/", "/api/cve/", "/api/search/"],
      },
    ],
    sitemap: [`${BASE_URL}/sitemap.xml`, `${BASE_URL}${NEWS_SITEMAP_PATH}`],
    host: BASE_URL,
  };
}
