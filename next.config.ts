import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // ── Turbopack externalization fix (P0 SEV3, 2026-04-18) ──────────────
  // Root cause: Next.js 16.2.3 + Turbopack produced a build where
  // `next-mdx-remote/rsc` was externalized with a hashed alias (e.g.
  // `next-mdx-remote-bb3b2464f4f590a5/rsc`). At runtime, the server
  // chunk tried to resolve this hashed package name — but it only
  // exists as an internal Turbopack alias, not an actual package in
  // node_modules. Every article detail page 500'd with:
  //   Error [ERR_MODULE_NOT_FOUND]: Cannot find package
  //   'next-mdx-remote-bb3b2464f4f590a5' imported from
  //   .next/server/chunks/ssr/[turbopack]_runtime.js
  //
  // Discovered via `npx next start` in foreground (PM2 was swallowing
  // the error in cluster-mode log redirection). Listings worked because
  // they don't import compileMDX; only article detail pages did.
  //
  // Fix: transpilePackages forces Next.js/Turbopack to INCLUDE the
  // package in the server bundle instead of externalizing it via a
  // hashed alias. Since we always want this package resolved at
  // build-time (not dynamically loaded), bundling it is correct.
  transpilePackages: ["next-mdx-remote"],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "fal.media" },
      { protocol: "https", hostname: "*.fal.media" },
    ],
  },
  async headers() {
    // ── Cache policy (P0 fix, 2026-04-18) ────────────────────────────
    // Prior state: every page emitted
    //   Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
    // Cloudflare respected the directive and refused to cache, producing
    // a 7.6% CF cache hit rate + 193 MB uncached origin bandwidth per day.
    //
    // Fix: emit Cache-Control: public, s-maxage=..., stale-while-revalidate=...
    // on PUBLIC content routes ONLY. /admin and /api keep their private
    // defaults so authenticated data never lands in shared caches.
    //
    // Directive anatomy:
    //   public            → shared caches (CDN/CF) may store
    //   s-maxage=N        → shared-cache lifetime (browser cache unaffected)
    //   stale-while-revalidate=M
    //                     → serve stale up to M seconds older than s-maxage
    //                       while CF fetches fresh copy in background; gives
    //                       visitors instant responses even when revalidating
    //
    // Lifetimes chosen to match our ISR schedule + revalidatePath/Tag
    // flow so content stays fresh:
    //   Articles/TI pages:     1h (matches revalidate = 3600 in page.tsx)
    //   Homepage + listings:   1h (revalidate = 3600 in [locale]/page.tsx)
    //   /salary:               6h (revalidate = 86400 in salary page.tsx;
    //                              6h is aggressive-enough for daily XHS
    //                              traffic while soft-refreshing the data)
    //   sitemap.xml + robots:  1h (dynamic but cacheable)
    //   Static assets:         1y + immutable (Next.js hashes filenames)
    //
    // Admin mutations continue to call revalidatePath()/revalidateTag()
    // which invalidates the Next.js ISR cache. CF cache will purge via
    // the separate revalidate endpoint below OR naturally expire via
    // s-maxage. For instant CF purge after admin publish, add a CF API
    // call in lib/revalidate-client.ts (future enhancement).
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://www.googletagservices.com https://adservice.google.com https://plausible.io; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self'; connect-src 'self' https://pagead2.googlesyndication.com https://plausible.io; frame-src https://googleads.g.doubleclick.net https://www.google.com;",
      },
    ];

    // Cache-Control values
    const cacheHour = "public, s-maxage=3600, stale-while-revalidate=86400";
    const cacheTenMin = "public, s-maxage=600, stale-while-revalidate=3600";
    const cacheSixHour = "public, s-maxage=21600, stale-while-revalidate=86400";
    const cacheStaticAsset = "public, max-age=31536000, immutable";
    const cacheAdminPrivate = "private, no-cache, no-store, must-revalidate";

    return [
      // ── Security headers apply site-wide ────────────────────────────
      { source: "/(.*)", headers: securityHeaders },

      // ── Admin routes: NEVER cache (explicit override of CF) ─────────
      // Also covers /admin/login, /admin/compose, /admin/articles, etc.
      // The Cache-Control here is redundant with Next.js's default for
      // auth'd pages, but we set it explicitly so no misconfigured CF
      // Cache Rule can override it.
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: cacheAdminPrivate },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: cacheAdminPrivate }],
      },
      {
        source: "/api/revalidate",
        headers: [{ key: "Cache-Control", value: cacheAdminPrivate }],
      },

      // ── Public content routes: 1-hour edge cache + SWR ──────────────
      // Match /en/* and /zh/* — everything user-facing except admin.
      // Applies to homepage (/en, /zh), article detail, threat-intel
      // detail, listings, tag pages, category pages, salary filter views.
      {
        source: "/:locale(en|zh)/:path*",
        headers: [{ key: "Cache-Control", value: cacheHour }],
      },
      // Locale roots themselves (no trailing path)
      {
        source: "/:locale(en|zh)",
        headers: [{ key: "Cache-Control", value: cacheHour }],
      },

      // ── /salary specifically: 6-hour cache ──────────────────────────
      // The dataset refreshes quarterly, XHS traffic is steady. Longer
      // cache lifetime = lower origin load + faster first paint.
      // NOTE: /salary is NOT a locale route — it exists under /en/salary
      // and /zh/salary, so this is covered by the rule above. But we
      // override explicitly for the filter variants to hold longer.
      {
        source: "/:locale(en|zh)/salary",
        headers: [{ key: "Cache-Control", value: cacheSixHour }],
      },

      // ── Sitemap + robots: 1-hour edge cache ─────────────────────────
      {
        source: "/sitemap.xml",
        headers: [{ key: "Cache-Control", value: cacheHour }],
      },
      {
        source: "/robots.txt",
        headers: [{ key: "Cache-Control", value: cacheHour }],
      },

      // ── Public feeds/search: 10-minute edge cache ───────────────────
      // These artifacts are regenerated on content-only deploys and are
      // discovery surfaces, so keep them fresher than article HTML.
      {
        source: "/api/feed",
        headers: [{ key: "Cache-Control", value: cacheTenMin }],
      },
      {
        source: "/api/wechat",
        headers: [{ key: "Cache-Control", value: cacheTenMin }],
      },
      {
        source: "/pagefind/:path*",
        headers: [{ key: "Cache-Control", value: cacheTenMin }],
      },

      // ── Next.js static assets: immutable 1-year cache ───────────────
      // Next.js emits hashed filenames so the cache-buster is the path
      // itself — changing an asset changes its filename, so 1-year is
      // safe and the browser will never serve a stale hashed asset.
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: cacheStaticAsset }],
      },

      // ── Public images: 7-day edge cache ─────────────────────────────
      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
