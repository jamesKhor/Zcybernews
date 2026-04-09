import { auth } from "@/auth";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import type { FeedArticle } from "@/lib/rss/fetch";

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
});

type SynthesizeRequest = {
  articles: FeedArticle[];
  style?: string;
  targetLength?: "short" | "medium" | "long";
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as SynthesizeRequest;
  const { articles, style = "professional cybersecurity journalist", targetLength = "medium" } = body;

  if (!articles || articles.length === 0) {
    return NextResponse.json({ error: "No articles provided" }, { status: 400 });
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY not configured" }, { status: 503 });
  }

  const wordCount = { short: "400-600", medium: "700-900", long: "1000-1300" }[targetLength];

  const sourceContext = articles
    .map(
      (a, i) =>
        `SOURCE ${i + 1}: "${a.title}" (from ${a.sourceName})\n${a.excerpt}`
    )
    .join("\n\n---\n\n");

  const prompt = `You are a ${style} writing for AleCyberNews, a cybersecurity and tech news site covering both English and Chinese-speaking audiences.

You have been given ${articles.length} source article(s) on a related topic. Synthesize them into ONE original, well-structured article that:
- Combines unique insights from all sources
- Does NOT copy sentences verbatim — rewrite entirely in your own words
- Is ${wordCount} words long
- Uses markdown formatting (## for sections, **bold** for key terms, \`code\` for CVE IDs/tools)
- Starts with a compelling lead paragraph (no heading)
- Includes 2-4 section headings (##)
- Ends with a "Key Takeaways" section
- Is factual, precise, and security-focused

SOURCES:
${sourceContext}

Now write the synthesized article in markdown. Do not include a title — return only the body content.`;

  try {
    const { text } = await generateText({
      model: deepseek("deepseek-chat"),
      prompt,
      maxOutputTokens: 2000,
      temperature: 0.6,
    });

    // Generate suggested metadata from sources
    const suggestedTitle = await generateText({
      model: deepseek("deepseek-chat"),
      prompt: `Based on this article content, write a concise, SEO-friendly headline (max 80 characters). Return ONLY the headline, no quotes.\n\n${text.slice(0, 500)}`,
      maxOutputTokens: 50,
      temperature: 0.4,
    });

    const suggestedSlug = suggestedTitle.text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60);

    const today = new Date().toISOString().split("T")[0];
    const primaryCategory = articles[0]?.sourceCategory ?? "cybersecurity";
    const tags = [
      ...new Set(articles.flatMap((a) => a.tags ?? []).filter(Boolean).slice(0, 6)),
    ];

    return NextResponse.json({
      content: text,
      suggested: {
        title: suggestedTitle.text.replace(/^["']|["']$/g, ""),
        slug: `${today}-${suggestedSlug}`,
        category: primaryCategory,
        tags,
        excerpt: text.split("\n").find((l) => l.trim().length > 80)?.slice(0, 200) ?? "",
      },
    });
  } catch (err) {
    console.error("[api/admin/synthesize]", err);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
