import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Secret-guarded revalidation endpoint.
 *
 * Called by:
 *   - Admin publish APIs (after a commit lands) — path + locale-specific
 *   - deploy-vps.yml content-path workflow (after git pull) — tag-based broad
 *
 * Secret must be supplied either as `x-revalidate-secret` header OR as a
 * `?secret=` query param (for convenience in curl commands from workflows).
 *
 * Usage:
 *   POST /api/revalidate?path=/en/articles/some-slug
 *   POST /api/revalidate?tag=articles
 *   POST /api/revalidate?path=/en/articles&tag=articles   (both)
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "REVALIDATE_SECRET not configured on server" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const headerSecret = req.headers.get("x-revalidate-secret");
  const querySecret = url.searchParams.get("secret");
  const supplied = headerSecret ?? querySecret;

  if (supplied !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const path = url.searchParams.get("path");
  const tag = url.searchParams.get("tag");

  if (!path && !tag) {
    return NextResponse.json(
      { error: "Provide ?path= and/or ?tag= query param" },
      { status: 400 },
    );
  }

  const revalidated: { paths: string[]; tags: string[] } = {
    paths: [],
    tags: [],
  };

  if (path) {
    // Revalidate the page AND any layouts that wrap it so listing pages update too
    revalidatePath(path);
    revalidated.paths.push(path);
  }
  if (tag) {
    // Next.js 16 requires the second arg. 'max' = stale-while-revalidate
    // (serve stale HTML while regenerating in background) — ideal for a
    // content site where "near-instant" is good enough and availability wins.
    revalidateTag(tag, "max");
    revalidated.tags.push(tag);
  }

  // ── Cloudflare edge cache purge (best-effort, optional) ────────────
  // When next.config.ts emits Cache-Control: public, s-maxage=3600 on
  // public pages (2026-04-18 P0 cache fix), Cloudflare holds the HTML
  // at the edge for 1h. After admin publishes or the AI pipeline commits,
  // the ISR cache flip above makes the NEW page available at origin —
  // but CF will keep serving the STALE page for up to 1h until it
  // naturally expires.
  //
  // This call purges the specific URL from CF so visitors see the update
  // within seconds. Silent no-op if CF credentials aren't configured
  // (defer-until-configured pattern — main revalidate still succeeds).
  //
  // Env vars needed (add via operator when ready):
  //   CLOUDFLARE_API_TOKEN — fine-grained: Zone.Cache Purge permission
  //   CLOUDFLARE_ZONE_ID   — from Cloudflare dashboard (zone overview)
  //   NEXT_PUBLIC_SITE_URL — already set (https://zcybernews.com)
  const cfPurged = await maybePurgeCloudflare(path);
  const out: Record<string, unknown> = {
    revalidated,
    now: new Date().toISOString(),
  };
  if (cfPurged !== null) out.cloudflare_purged = cfPurged;

  return NextResponse.json(out);
}

/**
 * Best-effort Cloudflare cache purge. Returns:
 *   null   — CF env not configured (operator hasn't enabled the feature yet)
 *   true   — purge API returned success
 *   false  — purge API returned error (logged; does not fail the request)
 */
async function maybePurgeCloudflare(
  path: string | null,
): Promise<boolean | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId || !path) return null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";
  const fullUrl = path.startsWith("http") ? path : `${siteUrl}${path}`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: [fullUrl] }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) return true;
    console.warn(
      `[revalidate] CF purge failed for ${fullUrl}: ${res.status} ${res.statusText}`,
    );
    return false;
  } catch (err) {
    console.warn(
      `[revalidate] CF purge error for ${fullUrl}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// GET returns a quick health-check so workflows can verify the endpoint
// is reachable without actually invalidating anything.
export async function GET(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const supplied = new URL(req.url).searchParams.get("secret");
  if (!secret || supplied !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, configured: true });
}
