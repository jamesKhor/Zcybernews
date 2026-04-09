import { auth } from "./auth";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextResponse } from "next/server";

const intlMiddleware = createMiddleware({
  ...routing,
});

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Protect all /admin routes except the login page itself
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.auth) {
      const loginUrl = new URL("/admin/login", req.url);
      loginUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // WeChat browser detection — MicroMessenger is the WeCom/WeChat UA identifier
  const userAgent = req.headers.get("user-agent") ?? "";
  const isWechat =
    userAgent.includes("MicroMessenger") || userAgent.includes("WeChat");

  if (isWechat && (pathname === "/" || pathname.startsWith("/en"))) {
    const zhUrl = req.nextUrl.clone();
    zhUrl.pathname =
      pathname === "/" ? "/zh" : pathname.replace(/^\/en/, "/zh");
    return NextResponse.redirect(zhUrl);
  }

  return intlMiddleware(req);
});

export const config = {
  matcher: [
    // Match all pathnames except /api, /_next, /_vercel, and static files
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
