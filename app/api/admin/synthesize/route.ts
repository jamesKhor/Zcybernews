import { auth } from "@/auth";
import { NextRequest } from "next/server";
import type { FeedArticle } from "@/lib/rss/fetch";
import { generateWithFallback, getActiveProvider } from "@/lib/ai-provider";

type PastedText = { label?: string; text: string };

type SynthesizeRequest =
  | {
      articles: FeedArticle[];
      pastedTexts?: never;
      targetLength?: "short" | "medium" | "long";
      customPrompt?: string;
      provider?: "auto" | "deepseek" | "kimi";
    }
  | {
      articles?: never;
      pastedTexts: PastedText[];
      targetLength?: "short" | "medium" | "long";
      customPrompt?: string;
      provider?: "auto" | "deepseek" | "kimi";
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

// Word count guidance — long has no upper cap
const WORD_COUNT_GUIDANCE = {
  short: { label: "400–600", instruction: "400–600 words" },
  medium: { label: "700–900", instruction: "700–900 words" },
  long: {
    label: "1000+",
    instruction:
      "at least 1000 words — be thorough, cover all technical details, do not truncate",
  },
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return new Response(
      JSON.stringify({ type: "error", message: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  if (getActiveProvider() === "none") {
    return new Response(
      JSON.stringify({
        type: "error",
        message:
          "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = (await req.json()) as SynthesizeRequest;
  const { targetLength = "medium", customPrompt, provider = "auto" } = body;
  const wc = WORD_COUNT_GUIDANCE[targetLength];

  // Build source context
  let sourceContext: string;
  let primaryCategory: ValidCategory = "threat-intel";
  let autoTags: string[] = [];
  let sourceCount: number;

  if (body.pastedTexts && body.pastedTexts.length > 0) {
    const validBlocks = body.pastedTexts.filter((b) => b.text.trim());
    if (validBlocks.length === 0) {
      return new Response(
        JSON.stringify({ type: "error", message: "No text provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    sourceCount = validBlocks.length;
    sourceContext = validBlocks
      .map(
        (b, i) =>
          `SOURCE ${i + 1}${b.label ? ` (${b.label})` : ""}:\n${b.text.trim()}`,
      )
      .join("\n\n---\n\n");
  } else if (body.articles && body.articles.length > 0) {
    const { articles } = body;
    sourceCount = articles.length;
    primaryCategory = clampCategory(articles[0]?.sourceCategory);
    autoTags = [
      ...new Set(articles.flatMap((a) => a.tags ?? []).filter(Boolean)),
    ].slice(0, 6);
    sourceContext = articles
      .map(
        (a, i) =>
          `SOURCE ${i + 1}: "${a.title}" (from ${a.sourceName})\n${a.excerpt}`,
      )
      .join("\n\n---\n\n");
  } else {
    return new Response(
      JSON.stringify({ type: "error", message: "No sources provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const customInstruction = customPrompt?.trim()
    ? `\nADDITIONAL INSTRUCTIONS FROM EDITOR:\n${customPrompt.trim()}\n`
    : "";

  // ── Streaming NDJSON response ───────────────────────────────────────────────
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (data: object) => {
    try {
      writer.write(encoder.encode(JSON.stringify(data) + "\n"));
    } catch {
      // writer already closed — ignore
    }
  };

  // Run generation async; stream events back as they happen
  (async () => {
    try {
      send({
        type: "status",
        step: "writing",
        message: "Starting article generation…",
      });

      // Step 1: Generate article body — tries free models first, DeepSeek as last resort
      const {
        text: articleBody,
        modelUsed: bodyModel,
        usedPaidFallback: bodyWasPaid,
      } = await generateWithFallback(
        `You are a senior cybersecurity journalist and SEO writer for ZCyberNews, a professional threat intelligence news site.

Synthesize the following ${sourceCount} source(s) into ONE original, SEO-optimised article that:

CONTENT RULES:
- Combines unique insights from ALL sources into a single coherent narrative
- Does NOT copy sentences verbatim — rewrite entirely in your own words
- Is ${wc.instruction}
- Is factual, technically precise, no marketing language — write like Krebs on Security
- Attributes claims where possible ("according to researchers", "Mandiant reports", etc.)

SEO RULES:
- Use the primary keyword (the main threat/CVE/actor name) naturally in the first 100 words
- Each ## section heading should contain a descriptive keyword phrase, not vague labels
  ✓ "## How APT29 Used Phishing to Bypass MFA" not "## Attack Details"
  ✓ "## Patch Now: Affected Versions and CVE Details" not "## Mitigation"
- Use **bold** for first mention of threat actors, CVE IDs, tool names
- Use \`code formatting\` for CVE IDs, hashes, file paths, commands
- Include internal linking hints with [keyword] placeholders where related topics exist

STRUCTURE (in this order):
1. Lead paragraph — WHO did WHAT to WHOM, WHY it matters (no heading)
2. ## [Descriptive section on technical details / attack chain]
3. ## [Descriptive section on impact / affected systems / scope]
4. ## [Descriptive section on detection / indicators of compromise]
5. ## Key Takeaways — 3-5 bullet points summarising actions defenders should take
${customInstruction}
SOURCES:
${sourceContext}

Return ONLY the article body in markdown. Do not include a title or frontmatter.`,
        {
          maxOutputTokens: 6000,
          temperature: 0.6,
          provider,
          onStatus: (message, model) => {
            send({ type: "status", step: "writing", message, model });
          },
        },
      );

      send({
        type: "status",
        step: "metadata",
        message: `Article written (${bodyModel.split("/").pop()}) — generating SEO metadata…`,
        model: bodyModel,
      });

      // Step 2: Generate SEO-optimised title + category + excerpt + tags
      const {
        text: metaRaw,
        modelUsed: metaModel,
        usedPaidFallback: metaWasPaid,
      } = await generateWithFallback(
        `You are an SEO specialist for a cybersecurity news site. Based on this article, return a JSON object:

{
  "title": "<SEO headline: put primary keyword near the start, 50-70 characters, no clickbait>",
  "category": "<one of the exact values below>",
  "excerpt": "<meta description: plain text only, NO markdown, 1-2 sentences, include primary keyword, state the key fact clearly, 120-160 characters>",
  "tags": ["<5-8 specific lowercase tags: CVE IDs, threat actor names, tools, techniques — avoid generic terms like 'cybersecurity' or 'hacking'>"]
}

TITLE RULES:
- Start with the most important keyword (threat actor, CVE, product name)
- Be specific: "APT29 Exploits Outlook Zero-Day CVE-2024-1234 in NATO Attacks" beats "Russian Hackers Target Europe"
- 50-70 characters (Google shows ~60 chars in search results)

EXCERPT RULES:
- This is the Google meta description — it must make someone want to click
- Include: what happened, who is affected, why it matters
- 120-160 characters

TAGS RULES:
- Use specific terms that people actually search for
- Include CVE IDs if present, specific malware names, threat actor aliases, affected vendor names

VALID CATEGORY VALUES (use EXACTLY one):
${CATEGORY_DESCRIPTIONS}

Return ONLY the JSON object, no markdown fences, no explanation.

ARTICLE:
${articleBody.slice(0, 1200)}`,
        {
          maxOutputTokens: 400,
          temperature: 0.2,
          provider,
          onStatus: (message, model) => {
            send({ type: "status", step: "metadata", message, model });
          },
        },
      );

      // Parse meta — fall back to safe defaults if AI returns garbage
      let aiTitle = "";
      let aiCategory: ValidCategory = primaryCategory;
      let aiExcerpt = "";
      let aiTags: string[] = autoTags;

      try {
        const cleaned = metaRaw.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned) as {
          title?: string;
          category?: string;
          excerpt?: string;
          tags?: string[];
        };
        aiTitle = parsed.title?.trim() ?? "";
        aiCategory = clampCategory(parsed.category?.trim());
        aiExcerpt = parsed.excerpt?.trim() ?? "";
        if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
          aiTags = parsed.tags
            .map((t) => String(t).toLowerCase().trim())
            .filter(Boolean)
            .slice(0, 8);
        }
      } catch {
        // Fallback: extract title from first non-empty line of body
        aiTitle =
          articleBody
            .split("\n")
            .find((l) => l.replace(/^#+\s*/, "").length > 10)
            ?.replace(/^#+\s*/, "")
            .slice(0, 80) ?? "Untitled";
      }

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
      const usedPaidFallback = bodyWasPaid || metaWasPaid;
      const modelsUsed = [...new Set([bodyModel, metaModel])];

      send({
        type: "done",
        content: articleBody,
        suggested: {
          title: aiTitle,
          slug: `${today}-${slugBase}`,
          category: aiCategory,
          tags: aiTags,
          excerpt: aiExcerpt,
        },
        usedPaidFallback,
        modelsUsed,
      });
    } catch (err) {
      console.error("[api/admin/synthesize]", err);
      const message =
        err instanceof Error ? err.message : "AI generation failed";
      send({ type: "error", message });
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
