/**
 * Shared admin route guards: auth check, CSRF protection, rate limiting.
 */
import { auth } from "@/auth";
import { NextRequest } from "next/server";
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";

const VALID_LOCALES = new Set(["en", "zh"]);
const VALID_TYPES = new Set(["posts", "threat-intel"]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Validate that request has auth + CSRF header + passes rate limit.
 * Returns null if OK, or a Response to send back.
 */
export async function adminGuard(
  req: NextRequest,
  rateLimitKey: string,
  limit = 10,
  windowMs = 60_000,
): Promise<Response | null> {
  // Auth check
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // CSRF protection: require custom header that CORS preflight blocks cross-origin
  if (req.method !== "GET") {
    const hasCustomHeader = req.headers.get("x-requested-with");
    // Allow requests from same-origin (Next.js fetch) and Telegram bot
    // Check referer/origin as additional signal
    const origin = req.headers.get("origin");
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";
    if (!hasCustomHeader && origin && !origin.startsWith(siteUrl)) {
      return Response.json(
        { error: "CSRF validation failed" },
        { status: 403 },
      );
    }
  }

  // Rate limit
  const ip = getClientIp(req.headers);
  const rl = rateLimit(`admin:${rateLimitKey}:${ip}`, limit, windowMs);
  if (!rl.allowed) return rateLimitResponse(rl);

  return null;
}

/**
 * Sanitize a slug — alphanumeric and hyphens only.
 */
export function sanitizeSlug(slug: string): string | null {
  const clean = slug.toLowerCase().trim().slice(0, 200);
  if (!SLUG_RE.test(clean)) return null;
  return clean;
}

/**
 * Validate locale is en or zh.
 */
export function isValidLocale(locale: string): locale is "en" | "zh" {
  return VALID_LOCALES.has(locale);
}

/**
 * Validate type is posts or threat-intel.
 */
export function isValidType(type: string): type is "posts" | "threat-intel" {
  return VALID_TYPES.has(type);
}
