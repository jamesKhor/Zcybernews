import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import { adminGuard, isValidLocale, isValidType } from "@/lib/admin-guard";
import { commitSingleFileToGitHub } from "@/lib/github-commit";
import { ArticleFrontmatterSchema } from "@/lib/types";
import { triggerRevalidate } from "@/lib/revalidate-client";

type PublishRequest = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  tags: string[];
  locale: "en" | "zh";
  type: "posts" | "threat-intel";
  author?: string;
};

function buildMdx(req: PublishRequest): { mdx: string; frontmatter: unknown } {
  const date = new Date().toISOString().split("T")[0];
  const fm: Record<string, unknown> = {
    title: req.title.replace(/\n/g, " "),
    slug: req.slug,
    date,
    excerpt: req.excerpt.replace(/\n/g, " ").slice(0, 200),
    category: req.category,
    tags: req.tags,
    language: req.locale ?? "en",
    author: req.author ?? "ZCyberNews",
    draft: false,
  };
  return { mdx: matter.stringify(req.content, fm), frontmatter: fm };
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req, "publish", 10, 60_000);
  if (guard) return guard;

  const body = (await req.json()) as PublishRequest;
  const { title, slug, content, locale = "en", type = "posts" } = body;

  if (!title || !slug || !content) {
    return NextResponse.json(
      { error: "title, slug and content are required" },
      { status: 400 },
    );
  }
  if (!isValidLocale(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
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

  // Consistency with AI pipeline: the frontmatter slug AND the filename
  // both include the date prefix. This prevents the "Article not found"
  // bug where the list endpoint returns frontmatter.slug but the real
  // file path has a different prefix. See write-mdx.ts for the pipeline
  // equivalent — both must match.
  const date = new Date().toISOString().split("T")[0];
  const bareSlug = slug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const datedSlug = `${date}-${bareSlug}`;

  // Build MDX with the DATED slug so the frontmatter.slug field matches
  // the filename on disk. This is the canonical form going forward.
  const { mdx, frontmatter } = buildMdx({ ...body, slug: datedSlug });

  // Validate before commit — blocks bad frontmatter from reaching the repo
  const parsed = ArticleFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid frontmatter", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const filename = `${datedSlug}.mdx`;
  const filePath = `content/${locale}/${type}/${filename}`;
  const commitMessage = `content: add "${title}" [${locale}]`;

  try {
    const { url } = await commitSingleFileToGitHub(
      filePath,
      mdx,
      commitMessage,
    );

    // Revalidate — make the new article visible without waiting for rebuild
    // Use datedSlug so it matches the actual route/filename (page URL is
    // /articles/{datedSlug} since content loader reads filename).
    const pathPrefix = type === "threat-intel" ? "threat-intel" : "articles";
    await Promise.allSettled([
      triggerRevalidate({ path: `/${locale}/${pathPrefix}/${datedSlug}` }),
      triggerRevalidate({ tag: "articles" }),
    ]);

    return NextResponse.json({
      success: true,
      path: filePath,
      githubUrl: url,
      message: "Article committed. Site will update shortly.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/publish]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
