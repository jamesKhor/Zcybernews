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

  // CSRF protection: mutating requests MUST include x-requested-with header.
  // Browser form submissions and cross-origin requests won't include this header,
  // and CORS preflight will block cross-origin requests that try to add it.
  if (req.method !== "GET") {
    const hasCustomHeader = req.headers.get("x-requested-with");
    if (!hasCustomHeader) {
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
 *
 * Normalizes leading/trailing hyphens before validation so that legacy
 * articles with slugs like "foo-bar-" (produced by an 80-char truncation
 * bug in earlier pipeline runs) can still be edited via the admin route.
 * The regex itself remains strict — after the trim step, a slug with
 * mid-string problems (double hyphens mid-slug, non-alphanum) still
 * fails. Pattern: fix the URL at the edge, keep storage strict.
 */
export function sanitizeSlug(slug: string): string | null {
  const clean = slug
    .toLowerCase()
    .trim()
    .slice(0, 200)
    // Strip leading/trailing hyphens that slipped in via filename drift
    .replace(/^-+|-+$/g, "");
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
