import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { type NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({ ...routing });

// /admin/** is excluded from the matcher below so this proxy never runs for
// admin routes — next-intl cannot add a locale prefix to them.
// Auth for /admin/** is enforced server-side in app/admin/(protected)/layout.tsx.

// ── Canonical host policy (2026-04-18, P0 SEO fix) ────────────────────────
// Search Console revealed 3 URL variants indexed for the same article:
//   https://www.zcybernews.com/en/articles/...    ← 124 impressions
//   https://zcybernews.com/en/articles/...        ← 39 impressions
//   https://zcybernews.com/articles/...           ← 10 impressions (no locale)
//
// All three returned 307 (or 200) and competed for the same query. Page rank
// was splitting across them. Fixes below:
//
//   1. www.zcybernews.com/*  → 308 permanent → zcybernews.com/*
//      308 (not 301/307) because: preserves method + tells Google the move
//      is permanent. Google consolidates rank to the target within days.
//
//   2. /articles/* (no locale) → 308 permanent → /en/articles/*
//      Previously next-intl emitted 307 (temporary) for locale-less paths,
//      which Google reads as "don't remove the source URL." 308 removes
//      them from the index on next crawl.
//
// Both rules run BEFORE next-intl's intlMiddleware so the 308 status wins.
// Root `/` still gets handed to next-intl so Accept-Language detection
// (legitimately content-negotiated) stays as 307.
const CANONICAL_HOST = "zcybernews.com";

function hasLocalePrefix(pathname: string): boolean {
  return routing.locales.some(
    (loc) => pathname === `/${loc}` || pathname.startsWith(`/${loc}/`),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  // ── 1) www → apex (permanent) ─────────────────────────────────────────────
  // Match only www subdomain; leave localhost / preview domains alone.
  //
  // Port-stripping rationale: behind Nginx reverse proxy, request.nextUrl
  // has `port: "3000"` (the internal Node origin port). When we mutate
  // apexUrl.host = "zcybernews.com" but leave the port, NextResponse.redirect
  // produces `Location: https://zcybernews.com:3000/` which is unreachable
  // from the public internet (Cloudflare + Nginx only expose :443).
  // Building the URL from scratch avoids inheriting the origin port.
  if (host.startsWith("www.")) {
    const apexUrl = new URL(
      `${pathname}${search}`,
      `https://${CANONICAL_HOST}`,
    );
    return NextResponse.redirect(apexUrl, 308);
  }

  // ── 2) Locale-less paths → default locale (permanent) ─────────────────────
  // Root `/` is skipped — next-intl legitimately content-negotiates it via
  // Accept-Language (and root 307 is a standards-correct negotiation response).
  // For every other path that has no /en or /zh prefix, issue a 308 so Google
  // drops the old URL from the index instead of keeping it as "temporary."
  if (pathname !== "/" && !hasLocalePrefix(pathname)) {
    const localeUrl = request.nextUrl.clone();
    localeUrl.pathname = `/${routing.defaultLocale}${pathname}`;
    localeUrl.search = search;
    return NextResponse.redirect(localeUrl, 308);
  }

  // ── WeChat detection ──────────────────────────────────────────────────────
  const userAgent = request.headers.get("user-agent") ?? "";
  const isWechat =
    userAgent.includes("MicroMessenger") || userAgent.includes("WeChat");

  if (isWechat && (pathname === "/" || pathname.startsWith("/en"))) {
    const zhUrl = request.nextUrl.clone();
    zhUrl.pathname =
      pathname === "/" ? "/zh" : pathname.replace(/^\/en/, "/zh");
    return NextResponse.redirect(zhUrl);
  }

  // ── All other public routes: next-intl locale prefix + detection ──────────
  const response = intlMiddleware(request);
  return stampRscCacheHeaders(request, response);
}

// ── RSC cache-poisoning guard (2026-04-18, SEV1 fix) ──────────────────────
// Next.js App Router serves two kinds of responses per route:
//   1. Initial HTML (browser navigation) — Content-Type: text/html
//   2. RSC payload (client-side nav / prefetch) — Content-Type: text/x-component
// Both responses by default carry the same Cache-Control (our ISR routes
// emit `public, s-maxage=3600`). Cloudflare's default cache key is URL-
// only — it ignores the origin's `Vary: rsc` header. Result: one RSC
// prefetch can poison the edge cache so every subsequent HTML request
// for that URL receives the RSC payload (users see a raw JSON blob).
//
// Fix: force RSC requests to bypass ALL public/shared caches via
// `Cache-Control: private, no-store`. Browser-side, Next.js's own
// client router can still use the response for navigation. Edge-side,
// no CDN will cache a `private` response, so the poisoning path is
// closed regardless of CF Cache Rule config.
//
// Defense-in-depth: we ALSO document a CF Cache Rule that bypasses
// cache when the RSC header is present (docs/cf-rsc-bypass-rule.md).
// Either layer on its own prevents the bug; both together is belt +
// braces.
const RSC_HEADERS = [
  "rsc",
  "next-router-prefetch",
  "next-router-state-tree",
  "next-router-segment-prefetch",
];

function isRscRequest(req: NextRequest): boolean {
  for (const h of RSC_HEADERS) {
    const v = req.headers.get(h);
    if (v && v !== "0") return true;
  }
  return false;
}

function stampRscCacheHeaders(
  req: NextRequest,
  res: NextResponse | Response,
): NextResponse | Response {
  if (!isRscRequest(req)) return res;
  // Only mutate NextResponse / Response with mutable headers. Some
  // middleware return types are effectively immutable — fall back to
  // cloning a NextResponse in that case.
  try {
    res.headers.set("Cache-Control", "private, no-store");
    // Stamp Vary so any well-behaved cache that DOES look at it will
    // also recognize RSC as varying on these headers.
    res.headers.set(
      "Vary",
      [
        res.headers.get("Vary") ?? "",
        "RSC",
        "Next-Router-Prefetch",
        "Next-Router-State-Tree",
      ]
        .filter(Boolean)
        .join(", "),
    );
  } catch {
    // If the response is immutable, best-effort: do nothing. The CF
    // Cache Rule documented in docs/cf-rsc-bypass-rule.md is the
    // safety net.
  }
  return res;
}

export const config = {
  matcher: [
    // Match all pathnames EXCEPT:
    //   /api, /admin  — bypassed entirely (admin auth lives in layout.tsx)
    //   /_next, /_vercel — internals
    //   Next.js special routes: icon, apple-icon, opengraph-image,
    //     twitter-image, sitemap, robots, manifest — these are auto-
    //     generated at the app root and must NOT be locale-prefixed
    //   files with extensions (images, fonts, etc.)
    "/((?!api|admin|_next|_vercel|icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest|.*\\..*).*)",
  ],
};
