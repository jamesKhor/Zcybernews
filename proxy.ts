import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { type NextRequest, NextResponse } from "next/server";

const intlMiddleware = createMiddleware({ ...routing });

// /admin/** is excluded from the matcher below so this proxy never runs for
// admin routes — next-intl cannot add a locale prefix to them.
// Auth for /admin/** is enforced server-side in app/admin/(protected)/layout.tsx.

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
