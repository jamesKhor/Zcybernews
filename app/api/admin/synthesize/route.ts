import { auth } from "@/auth";
import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import type { FeedArticle } from "@/lib/rss/fetch";
import { getWriteModel, getActiveProvider } from "@/lib/ai-provider";

type PastedText = { label?: string; text: string };

type SynthesizeRequest =
  | {
      articles: FeedArticle[];
      pastedTexts?: never;
      targetLength?: "short" | "medium" | "long";
      customPrompt?: string;
    }
  | {
      articles?: never;
      pastedTexts: PastedText[];
      targetLength?: "short" | "medium" | "long";
      customPrompt?: string;
    };

// Valid categories — must match ArticleFrontmatterSchema exactly
const VALID_CATEGORIES = [
  "threat-intel",
  "vulnerabilities",
  "malware",
  "industry",
  "tools",
  "ai",
] as const;
type ValidCategory = (typeof VALID_CATEGORIES)[number];

const CATEGORY_DESCRIPTIONS = `
- "threat-intel"    : APT groups, nation-state attacks, threat actor campaigns, espionage
- "vulnerabilities" : CVEs, zero-days, patch advisories, exploit disclosure
- "malware"         : ransomware, trojans, spyware, malware analysis
- "industry"        : business news, mergers, regulation, policy, market trends
- "tools"           : security tools, defensive techniques, open-source utilities
- "ai"              : AI/ML in security, AI attacks/defences, generative AI risks`.trim();

function clampCategory(cat?: string): ValidCategory {
  return VALID_CATEGORIES.includes(cat as ValidCategory)
    ? (cat as ValidCategory)
    : "threat-intel";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (getActiveProvider() === "none") {
    return NextResponse.json(
      { error: "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY." },
      { status: 503 },
    );
  }

  const body = (await req.json()) as SynthesizeRequest;
  const { targetLength = "medium", customPrompt } = body;
  const wordCount = { short: "400-600", medium: "700-900", long: "1000-1300" }[
    targetLength
  ];

  // Build source context
  let sourceContext: string;
  let primaryCategory: ValidCategory = "threat-intel";
  let autoTags: string[] = [];
  let sourceCount: number;

  if (body.pastedTexts && body.pastedTexts.length > 0) {
    const validBlocks = body.pastedTexts.filter((b) => b.text.trim());
    if (validBlocks.length === 0)
      return NextResponse.json({ error: "No text provided" }, { status: 400 });

    sourceCount = validBlocks.length;
    sourceContext = validBlocks
      .map((b, i) => `SOURCE ${i + 1}${b.label ? ` (${b.label})` : ""}:\n${b.text.trim()}`)
      .join("\n\n---\n\n");
  } else if (body.articles && body.articles.length > 0) {
    const { articles } = body;
    sourceCount = articles.length;
    primaryCategory = clampCategory(articles[0]?.sourceCategory);
    autoTags = [
      ...new Set(articles.flatMap((a) => a.tags ?? []).filter(Boolean)),
    ].slice(0, 6);
    sourceContext = articles
      .map((a, i) => `SOURCE ${i + 1}: "${a.title}" (from ${a.sourceName})\n${a.excerpt}`)
      .join("\n\n---\n\n");
  } else {
    return NextResponse.json({ error: "No sources provided" }, { status: 400 });
  }

  const customInstruction = customPrompt?.trim()
    ? `\nADDITIONAL INSTRUCTIONS FROM EDITOR:\n${customPrompt.trim()}\n`
    : "";

  const model = getWriteModel();

  try {
    // Step 1: Generate article body
    const { text: articleBody } = await generateText({
      model,
      prompt: `You are a professional cybersecurity journalist writing for AleCyberNews.

Synthesize the following ${sourceCount} source(s) into ONE original article that:
- Combines unique insights from all sources
- Does NOT copy sentences verbatim — rewrite entirely in your own words
- Is ${wordCount} words long
- Uses markdown formatting (## for sections, **bold** for key terms, \`code\` for CVE IDs/tools)
- Starts with a compelling lead paragraph (no heading)
- Includes 2-4 section headings (##)
- Ends with a "## Key Takeaways" section
- Is factual, precise, and security-focused
${customInstruction}
SOURCES:
${sourceContext}

Write the article body in markdown. Do not include a title — return only the body content.`,
      maxOutputTokens: 2000,
      temperature: 0.6,
    });

    // Step 2: Generate title + category + excerpt in one call (enforces valid category)
    const { text: metaRaw } = await generateText({
      model,
      prompt: `Based on this cybersecurity article, return a JSON object with exactly these fields:
{
  "title": "<concise SEO-friendly headline, max 80 characters>",
  "category": "<one of the exact values below>",
  "excerpt": "<2-sentence summary, max 200 characters>"
}

VALID CATEGORY VALUES (you MUST use exactly one of these strings):
${CATEGORY_DESCRIPTIONS}

Return ONLY the JSON object, no markdown fences, no explanation.

ARTICLE:
${articleBody.slice(0, 800)}`,
      maxOutputTokens: 200,
      temperature: 0.2,
    });

    // Parse meta — fall back to safe defaults if AI returns garbage
    let aiTitle = "";
    let aiCategory: ValidCategory = primaryCategory;
    let aiExcerpt = "";

    try {
      const cleaned = metaRaw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned) as {
        title?: string;
        category?: string;
        excerpt?: string;
      };
      aiTitle = parsed.title?.trim() ?? "";
      // Double-clamp: AI output + our guard
      aiCategory = clampCategory(parsed.category?.trim());
      aiExcerpt = parsed.excerpt?.trim() ?? "";
    } catch {
      // Fallback: extract title from first non-empty line of body
      aiTitle =
        articleBody
          .split("\n")
          .find((l) => l.replace(/^#+\s*/, "").length > 10)
          ?.replace(/^#+\s*/, "")
          .slice(0, 80) ?? "Untitled";
    }

    // If excerpt still empty, derive from first long line
    if (!aiExcerpt) {
      aiExcerpt =
        articleBody
          .split("\n")
          .find((l) => l.trim().length > 80)
          ?.slice(0, 200) ?? "";
    }

    const slugBase = aiTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60);

    const today = new Date().toISOString().split("T")[0];

    return NextResponse.json({
      content: articleBody,
      suggested: {
        title: aiTitle,
        slug: `${today}-${slugBase}`,
        category: aiCategory,   // always a valid enum value
        tags: autoTags,
        excerpt: aiExcerpt,
      },
    });
  } catch (err) {
    console.error("[api/admin/synthesize]", err);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
