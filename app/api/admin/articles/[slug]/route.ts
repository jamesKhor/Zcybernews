import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import {
  adminGuard,
  isValidLocale,
  isValidType,
  sanitizeSlug,
} from "@/lib/admin-guard";

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo)
    throw new Error("GITHUB_TOKEN or GITHUB_REPO not configured");
  return { token, repo };
}

function buildApiUrl(repo: string, locale: string, type: string, slug: string) {
  const branch = process.env.GITHUB_BRANCH ?? "main";
  return {
    url: `https://api.github.com/repos/${repo}/contents/content/${locale}/${type}/${slug}.mdx`,
    branch,
  };
}

/**
 * Resolve a slug to an actual filename. Returns the real slug (filename
 * without .mdx) that exists on GitHub. Handles the legacy mismatch where
 * admin-composed articles stored frontmatter.slug without the date prefix
 * but the filename DOES have a date prefix.
 *
 * Lookup order:
 *   1. Direct: content/{locale}/{type}/{slug}.mdx — works if slug matches filename
 *   2. Fallback: scan directory for a file ending in `-{slug}.mdx`
 *      (matches pattern: `YYYY-MM-DD-{slug}.mdx`)
 *
 * Returns null if nothing matches.
 */
async function resolveFilenameSlug(
  token: string,
  repo: string,
  locale: string,
  type: string,
  slug: string,
): Promise<string | null> {
  // Direct hit first (cheap)
  const directUrl = `https://api.github.com/repos/${repo}/contents/content/${locale}/${type}/${slug}.mdx`;
  const directRes = await fetch(directUrl, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (directRes.ok) return slug;

  // Fallback: list the directory, look for `-{slug}.mdx`
  const dirUrl = `https://api.github.com/repos/${repo}/contents/content/${locale}/${type}`;
  const dirRes = await fetch(dirUrl, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!dirRes.ok) return null;

  const entries = (await dirRes.json()) as Array<{ name: string }>;
  if (!Array.isArray(entries)) return null;

  const target = `-${slug}.mdx`;
  const match = entries.find((e) => e.name.endsWith(target));
  return match ? match.name.replace(/\.mdx$/, "") : null;
}

// ─── GET: fetch raw file from GitHub for editing ─────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const guard = await adminGuard(req, "articles-read", 30, 60_000);
  if (guard) return guard;

  const { slug: rawSlug } = await params;
  const slug = sanitizeSlug(rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const locale = sp.get("locale") ?? "en";
  const type = sp.get("type") ?? "posts";

  if (!isValidLocale(locale) || !isValidType(type)) {
    return NextResponse.json(
      { error: "Invalid locale or type" },
      { status: 400 },
    );
  }

  try {
    const { token, repo } = getToken();
    // Resolve the real filename slug — tolerates admin-composed articles
    // whose frontmatter.slug was stored without date prefix.
    const resolvedSlug = await resolveFilenameSlug(
      token,
      repo,
      locale,
      type,
      slug,
    );
    if (!resolvedSlug) {
      return NextResponse.json(
        { error: `Article not found on GitHub` },
        { status: 404 },
      );
    }

    const { url } = buildApiUrl(repo, locale, type, resolvedSlug);

    const res = await fetch(url, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `File not found (${res.status})` },
        { status: 404 },
      );
    }

    const data = (await res.json()) as {
      content: string;
      sha: string;
      html_url: string;
    };
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    const { data: frontmatter, content: body } = matter(raw);

    return NextResponse.json({
      sha: data.sha,
      html_url: data.html_url,
      frontmatter,
      body: body.trim(),
      // Return resolved slug so the edit UI can save back to the right file
      resolvedSlug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── PATCH: update frontmatter (and optionally body) on GitHub ───────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const guard = await adminGuard(req, "articles-update", 10, 60_000);
  if (guard) return guard;

  const { slug: rawSlug } = await params;
  const slug = sanitizeSlug(rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  try {
    const { token, repo } = getToken();
    const body = (await req.json()) as {
      locale: string;
      type: string;
      frontmatter: Record<string, unknown>;
      body?: string;
    };

    const { locale, type, frontmatter: updatedFm, body: updatedBody } = body;

    if (!isValidLocale(locale) || !isValidType(type)) {
      return NextResponse.json(
        { error: "Invalid locale or type" },
        { status: 400 },
      );
    }

    // Resolve real filename (tolerates legacy admin-composed articles)
    const resolvedSlug = await resolveFilenameSlug(
      token,
      repo,
      locale,
      type,
      slug,
    );
    if (!resolvedSlug) {
      return NextResponse.json(
        { error: "Article not found on GitHub" },
        { status: 404 },
      );
    }
    const { url, branch } = buildApiUrl(repo, locale, type, resolvedSlug);

    // Fetch current file to get SHA + original body if not provided
    const getRes = await fetch(url, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (!getRes.ok) {
      return NextResponse.json(
        { error: "File not found on GitHub" },
        { status: 404 },
      );
    }

    const getData = (await getRes.json()) as { content: string; sha: string };
    const sha = getData.sha;
    const rawOriginal = Buffer.from(getData.content, "base64").toString(
      "utf-8",
    );
    const { data: originalFm, content: originalBody } = matter(rawOriginal);

    // Merge frontmatter
    const mergedFm = { ...originalFm, ...updatedFm };
    const bodyToUse =
      updatedBody !== undefined ? updatedBody : originalBody.trim();

    // Rebuild the file using gray-matter stringify
    const newRaw = matter.stringify(`\n${bodyToUse}`, mergedFm);

    const encoded = Buffer.from(newRaw, "utf-8").toString("base64");
    const putRes = await fetch(url, {
      method: "PUT",
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: `content: update "${mergedFm.title}" [${locale}]`,
        content: encoded,
        sha,
        branch,
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      return NextResponse.json(
        { error: `GitHub error ${putRes.status}: ${errText}` },
        { status: 500 },
      );
    }

    const putData = (await putRes.json()) as { content: { html_url: string } };
    return NextResponse.json({
      success: true,
      html_url: putData.content.html_url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── DELETE: delete file(s) from GitHub ─────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const guard = await adminGuard(req, "articles-delete", 5, 60_000);
  if (guard) return guard;

  const { slug: rawSlug } = await params;
  const slug = sanitizeSlug(rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  try {
    const { token, repo } = getToken();
    const body = (await req.json()) as {
      locale: string;
      type: string;
      deleteAll?: boolean; // delete both EN and ZH
    };

    const { locale, type, deleteAll } = body;

    if (!isValidLocale(locale) || !isValidType(type)) {
      return NextResponse.json(
        { error: "Invalid locale or type" },
        { status: 400 },
      );
    }
    const branch = process.env.GITHUB_BRANCH ?? "main";

    const localesToDelete = deleteAll ? ["en", "zh"] : [locale];
    const results: { locale: string; status: string }[] = [];

    for (const loc of localesToDelete) {
      // Resolve real filename per locale (legacy articles may differ)
      const resolvedSlug = await resolveFilenameSlug(
        token,
        repo,
        loc,
        type,
        slug,
      );
      if (!resolvedSlug) {
        results.push({ locale: loc, status: "not_found" });
        continue;
      }
      const { url } = buildApiUrl(repo, loc, type, resolvedSlug);

      // Get SHA first
      const getRes = await fetch(url, {
        headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
      });

      if (!getRes.ok) {
        // File doesn't exist in this locale — skip
        results.push({ locale: loc, status: "not_found" });
        continue;
      }

      const getData = (await getRes.json()) as { sha: string };
      const sha = getData.sha;

      const delRes = await fetch(url, {
        method: "DELETE",
        headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: `content: remove "${slug}" [${loc}]`,
          sha,
          branch,
        }),
      });

      if (!delRes.ok) {
        const errText = await delRes.text();
        results.push({ locale: loc, status: `error: ${errText}` });
      } else {
        results.push({ locale: loc, status: "deleted" });
      }
    }

    const anyError = results.some((r) => r.status.startsWith("error"));
    if (anyError) {
      return NextResponse.json(
        { error: "Some deletions failed", results },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
