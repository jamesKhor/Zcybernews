import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import { translateWithFallback, getActiveProvider } from "@/lib/ai-provider";
import { adminGuard, isValidType } from "@/lib/admin-guard";
import { commitFilesToGitHub } from "@/lib/github-commit";
import { ArticleFrontmatterSchema } from "@/lib/types";
import { triggerRevalidate } from "@/lib/revalidate-client";

type TranslatePublishRequest = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  tags: string[];
  type: "posts" | "threat-intel";
  author?: string;
};

function buildMdx(
  frontmatter: Record<string, unknown>,
  body: string,
): { mdx: string; parsedFrontmatter: unknown } {
  const date = new Date().toISOString().split("T")[0];
  const fm: Record<string, unknown> = {
    title: String(frontmatter.title).replace(/\n/g, " "),
    slug: String(frontmatter.slug),
    date,
    excerpt: String(frontmatter.excerpt).replace(/\n/g, " ").slice(0, 200),
    category: frontmatter.category,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    language: frontmatter.language,
    locale_pair: frontmatter.slug,
    author: frontmatter.author ?? "ZCyberNews",
    draft: false,
  };
  // gray-matter handles YAML escaping; also gives us back a parsed version
  // we can validate with Zod.
  const mdx = matter.stringify(body, fm);
  return { mdx, parsedFrontmatter: fm };
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req, "translate-publish", 5, 60_000);
  if (guard) return guard;

  const body = (await req.json()) as TranslatePublishRequest;
  const {
    title,
    slug,
    content,
    excerpt,
    category,
    tags,
    type = "posts",
    author,
  } = body;

  if (!title || !slug || !content) {
    return NextResponse.json(
      { error: "title, slug and content are required" },
      { status: 400 },
    );
  }
  if (!isValidType(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
  }
  if (content.length > 500_000) {
    return NextResponse.json({ error: "Content too large" }, { status: 400 });
  }
  if (getActiveProvider() === "none") {
    return NextResponse.json(
      {
        error:
          "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY.",
      },
      { status: 500 },
    );
  }

  // Translate title+excerpt and body IN PARALLEL — the two AI calls don't
  // depend on each other, so running them concurrently saves the ~2-3s of
  // the shorter meta call that used to be wasted waiting for the body.
  const [metaRes, bodyRes] = await Promise.all([
    translateWithFallback(
      `Translate these to Simplified Chinese. Keep threat actor names, malware names, ALL-CAPS acronyms (EDR, VPN, APT, CVE, IOC, TTP etc), product names in English. Return ONLY valid JSON: {"title": "...", "excerpt": "..."}\n\nTitle: ${title}\nExcerpt: ${excerpt}`,
      { maxOutputTokens: 300, temperature: 0.2, provider: "deepseek" },
    ),
    translateWithFallback(
      `You are a professional cybersecurity translator. Translate English to Simplified Chinese.
NEVER translate: threat actor names (LockBit, APT41, Lazarus Group etc), malware names (Mimikatz, Cobalt Strike etc), ALL-CAPS acronyms (EDR, VPN, RDP, CVE, IOC, TTP, APT, C2, LSASS, DLL, RaaS, WAF, SIEM etc), product/vendor names (Microsoft, Cisco, CrowdStrike etc), CVE IDs, hashes, IPs, domains, code blocks.
Keep all Markdown formatting intact. Output ONLY the translated markdown, no explanation.

Translate this article body to Simplified Chinese:

${content}`,
      { maxOutputTokens: 4000, temperature: 0.3, provider: "deepseek" },
    ),
  ]);

  let zhTitle = title;
  let zhExcerpt = excerpt;
  try {
    const clean = metaRes.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as { title: string; excerpt: string };
    zhTitle = parsed.title;
    zhExcerpt = parsed.excerpt;
  } catch {
    /* fallback to EN */
  }

  // Consistency with AI pipeline: frontmatter.slug AND filename both
  // include the date prefix. Fixes the "Article not found" edit bug where
  // the list endpoint returned frontmatter.slug but the real file path
  // had a different prefix. See write-mdx.ts for pipeline equivalent.
  const date = new Date().toISOString().split("T")[0];
  const bareSlug = slug.replace(/^[\d-]+-/, "");
  const datedSlug = `${date}-${bareSlug}`;
  const filename = `${datedSlug}.mdx`;

  const { mdx: enMdx, parsedFrontmatter: enFm } = buildMdx(
    {
      title,
      slug: datedSlug,
      excerpt,
      category,
      tags,
      language: "en",
      author: author ?? "ZCyberNews",
    },
    content,
  );
  const { mdx: zhMdx, parsedFrontmatter: zhFm } = buildMdx(
    {
      title: zhTitle,
      slug: datedSlug,
      excerpt: zhExcerpt,
      category,
      tags,
      language: "zh",
      author: author ?? "ZCyberNews",
    },
    bodyRes.text.trim(),
  );

  // Zod-validate both frontmatters BEFORE committing — prevents bad MDX from
  // reaching the repo and breaking ISR page renders at request time.
  const enParse = ArticleFrontmatterSchema.safeParse(enFm);
  const zhParse = ArticleFrontmatterSchema.safeParse(zhFm);
  if (!enParse.success || !zhParse.success) {
    return NextResponse.json(
      {
        error: "Invalid frontmatter",
        details: {
          en: enParse.success ? null : enParse.error.flatten(),
          zh: zhParse.success ? null : zhParse.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const usedPaidFallback = metaRes.usedPaidFallback || bodyRes.usedPaidFallback;

  try {
    // Single atomic commit containing BOTH files. One push event, one deploy.
    const commit = await commitFilesToGitHub(
      [
        { path: `content/en/${type}/${filename}`, content: enMdx },
        { path: `content/zh/${type}/${filename}`, content: zhMdx },
      ],
      `content: add "${title}" [en+zh]`,
    );

    // Fire-and-forget revalidation for both locales so live site surfaces
    // the new article within seconds without waiting for a rebuild.
    // Use datedSlug so the path matches the actual route (content loader
    // routes by filename, not by bare slug).
    const pathPrefix = type === "threat-intel" ? "threat-intel" : "articles";
    await Promise.allSettled([
      triggerRevalidate({ path: `/en/${pathPrefix}/${datedSlug}` }),
      triggerRevalidate({ path: `/zh/${pathPrefix}/${datedSlug}` }),
      triggerRevalidate({ tag: "articles" }),
    ]);

    return NextResponse.json({
      success: true,
      commitSha: commit.sha,
      commitUrl: commit.url,
      files: commit.files,
      message: "Published EN + ZH in one commit. Site will update shortly.",
      usedPaidFallback,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[translate-publish]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
