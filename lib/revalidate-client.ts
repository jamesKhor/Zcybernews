/**
 * Trigger revalidation of a path or tag on the running Next.js server.
 *
 * Used by the admin publish APIs to make newly-committed articles appear
 * on the live site in seconds, without waiting for a full VPS rebuild.
 *
 * The revalidation endpoint is on the SAME Next.js process that handled
 * the publish request, so we hit localhost by default. Do not use
 * NEXT_PUBLIC_SITE_URL here: in production that points at the public CDN,
 * which can turn a local cache flip into a best-effort edge request.
 *
 * If we ever host admin separately, set REVALIDATE_BASE_URL explicitly.
 */

export interface RevalidateArgs {
  path?: string;
  tag?: string;
}

export async function triggerRevalidate(args: RevalidateArgs): Promise<void> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    console.warn(
      "[revalidate] REVALIDATE_SECRET not set — skipping revalidation call",
    );
    return;
  }

  const base =
    process.env.REVALIDATE_BASE_URL ??
    process.env.INTERNAL_REVALIDATE_URL ??
    "http://localhost:3000";
  const url = new URL("/api/revalidate", base);
  if (args.path) url.searchParams.set("path", args.path);
  if (args.tag) url.searchParams.set("tag", args.tag);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      // Short timeout — if the endpoint hangs we don't want to block publish
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[revalidate] ${url.pathname} returned ${res.status}`);
    }
  } catch (err) {
    // Revalidation failures are non-fatal — the next hourly cache TTL will
    // refresh the page, and a full VPS deploy would anyway.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[revalidate] request failed: ${message}`);
  }
}
