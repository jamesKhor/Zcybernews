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
  if (host.startsWith("www.")) {
    const apexUrl = request.nextUrl.clone();
    apexUrl.host = CANONICAL_HOST;
    apexUrl.protocol = "https:";
    // NextResponse.redirect supports 308 as of Next 14+
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
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Match all pathnames EXCEPT:
    //   /api, /admin  — bypassed entirely (admin auth lives in layout.tsx)
    //   /_next, /_vercel — internals
    //   files with extensions (images, fonts, etc.)
    "/((?!api|admin|_next|_vercel|.*\\..*).*)",
  ],
};
