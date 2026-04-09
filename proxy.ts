import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { type NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({ ...routing });

// Auth enforcement for /admin/** is handled server-side in app/admin/layout.tsx.
// This proxy only needs to:
//   1. Pass /admin/** through WITHOUT adding a locale prefix (next-intl would break them)
//   2. Detect WeChat UA and redirect to /zh
//   3. Run next-intl locale routing for all other public routes

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin routes: bypass next-intl entirely ───────────────────────────────
  // next-intl would rewrite /admin/login → /en/admin/login (no page exists there)
  if (pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  // ── WeChat detection ─────────────────────────────────────────────────────
  const userAgent = request.headers.get("user-agent") ?? "";
  const isWechat =
    userAgent.includes("MicroMessenger") || userAgent.includes("WeChat");

  if (isWechat && (pathname === "/" || pathname.startsWith("/en"))) {
    const zhUrl = request.nextUrl.clone();
    zhUrl.pathname =
      pathname === "/" ? "/zh" : pathname.replace(/^\/en/, "/zh");
    return NextResponse.redirect(zhUrl);
  }

  // ── All other routes: next-intl handles locale prefix + detection ─────────
  return intlMiddleware(request);
}

export const config = {
  matcher: [
    // Match all pathnames except /api, /_next, /_vercel, and static files
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
