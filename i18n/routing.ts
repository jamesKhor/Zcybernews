import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "always",
  // Page metadata already emits canonical + hreflang links with the exact
  // section-aware URL helpers. The middleware-level HTTP Link header only
  // sees locale templates and has produced stale locale-less x-default URLs
  // such as /articles/<slug>, which splits Google signals.
  alternateLinks: false,
  // Disable the NEXT_LOCALE cookie.
  //
  // Why: (2026-04-18 P0 CF cache fix) next-intl sets `NEXT_LOCALE` as a
  // Set-Cookie on every response to remember the visitor's locale. With
  // `localePrefix: "always"`, the URL itself (/en/... or /zh/...) is the
  // authoritative locale source — the cookie is redundant.
  //
  // Impact: Cloudflare's default rule "don't cache responses with
  // Set-Cookie" was flipping `cf-cache-status` to BYPASS on every
  // content page, capping hit rate at 7.6%. Removing the cookie lets
  // CF cache HTML responses per the Cache Rule we deployed end-of-last-
  // session. Expected jump: BYPASS → HIT, hit rate → 60-75%.
  //
  // Safety: we don't use per-locale subdomains (so no cross-subdomain
  // persistence need), and Accept-Language detection at root `/` is
  // unaffected — next-intl reads the header on each request to redirect
  // to `/en` or `/zh`; it just no longer PERSISTS that choice in a
  // cookie. Users explicitly clicking the locale switcher still get
  // routed correctly because that's URL-driven, not cookie-driven.
  localeCookie: false,
});
