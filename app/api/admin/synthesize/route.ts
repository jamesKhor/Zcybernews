import { NextRequest } from "next/server";
import type { FeedArticle } from "@/lib/rss/fetch";
import { generateWithFallback, getActiveProvider } from "@/lib/ai-provider";
import { adminGuard } from "@/lib/admin-guard";
import { searchBrave, BraveSearchError } from "@/lib/brave-search";
import { fetchArticle } from "@/lib/article-fetcher";

type PastedText = { label?: string; text: string };

type SharedOptions = {
  targetLength?: "short" | "medium" | "long";
  customPrompt?: string;
  provider?: "auto" | "deepseek" | "kimi";
};

/**
 * Three mutually-exclusive input modes:
 * - `articles`: editor selected from RSS feed (existing)
 * - `pastedTexts`: editor pasted source text blocks (existing)
 * - `researchKeywords`: editor typed a trending-story keyword string;
 *    server searches Brave + fetches real articles (NEW)
 *
 * The researchKeywords mode is grounded in REAL sources — the LLM
 * never sees a query, only the extracted article text from Brave
 * search results. Requires minimum 2 usable sources or errors.
 */
type SynthesizeRequest =
  | ({
      articles: FeedArticle[];
      pastedTexts?: never;
      researchKeywords?: never;
    } & SharedOptions)
  | ({
      articles?: never;
      pastedTexts: PastedText[];
      researchKeywords?: never;
    } & SharedOptions)
  | ({
      articles?: never;
      pastedTexts?: never;
      researchKeywords: string;
    } & SharedOptions);

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
  const guard = await adminGuard(req, "synthesize", 5, 60_000);
  if (guard) return guard;

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
  // For paste + articles modes this is synchronous. For research mode we
  // defer to the streaming context so the user sees "searching…" / "fetching…"
  // progress (those steps take 5-15s combined).
  let sourceContext: string = "";
  let primaryCategory: ValidCategory = "threat-intel";
  let autoTags: string[] = [];
  let sourceCount = 0;
  // sourceUrls is only populated for research mode — becomes part of the
  // `done` payload so the compose UI can pre-fill source_urls frontmatter.
  let sourceUrls: string[] = [];
  let deferredResearchKeywords: string | null = null;

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
  } else if (body.researchKeywords && body.researchKeywords.trim()) {
    // Validate keyword shape: 1-100 chars, reasonable word count. No LLM
    // validation here — just format sanity. The actual anti-hallucination
    // guard is "require ≥2 successfully fetched sources" inside the stream.
    const kw = body.researchKeywords.trim();
    if (kw.length > 100) {
      return new Response(
        JSON.stringify({
          type: "error",
          message: "Keywords too long (max 100 characters)",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const wordCount = kw.split(/\s+/).filter(Boolean).length;
    if (wordCount > 8) {
      return new Response(
        JSON.stringify({
          type: "error",
          message:
            "Too many keywords (max 8). Focus on ONE story — e.g. 'Shiny Hunters Adaptivist breach'.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    deferredResearchKeywords = kw;
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
      // ── Research mode: search + fetch sources inside the stream ─────────
      // Paste + articles modes already populated sourceContext above. For
      // research mode we search Brave + fetch article text here so we can
      // stream "searching…" / "fetching…" progress to the UI.
      if (deferredResearchKeywords) {
        send({
          type: "status",
          step: "searching",
          message: `Searching Brave for "${deferredResearchKeywords}"…`,
        });

        let searchResults;
        try {
          searchResults = await searchBrave(deferredResearchKeywords, {
            count: 8,
            freshness: "pm", // past month — trending cyber stories
          });
        } catch (err) {
          const msg =
            err instanceof BraveSearchError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Search failed";
          send({
            type: "error",
            message: `Search error: ${msg}. ${err instanceof BraveSearchError && !process.env.BRAVE_SEARCH_API_KEY ? "Set BRAVE_SEARCH_API_KEY in .env.local." : ""}`,
          });
          writer.close();
          return;
        }

        if (searchResults.length < 2) {
          send({
            type: "error",
            message: `Only ${searchResults.length} search result(s) found. Try different or broader keywords.`,
          });
          writer.close();
          return;
        }

        // Cap at 5 fetches to keep total latency <15s and respect site load
        const toFetch = searchResults.slice(0, 5);
        send({
          type: "status",
          step: "fetching",
          message: `Found ${searchResults.length} results. Fetching ${toFetch.length} sources…`,
        });

        const fetched = await Promise.all(
          toFetch.map((r) => fetchArticle(r.url, 10_000)),
        );
        const usable = fetched.filter((f) => !f.error && f.text.length >= 300);

        if (usable.length < 2) {
          const errSummary = fetched
            .filter((f) => f.error)
            .map((f) => `${new URL(f.url).hostname}: ${f.error}`)
            .slice(0, 3)
            .join("; ");
          send({
            type: "error",
            message: `Only ${usable.length} source(s) had extractable content (need ≥2). ${errSummary ? "Failures: " + errSummary : ""}`,
          });
          writer.close();
          return;
        }

        // Assemble grounded source context — LLM sees ONLY real extracted text
        sourceCount = usable.length;
        sourceUrls = usable.map((f) => f.url);
        sourceContext = usable
          .map((f, i) => {
            let host = f.url;
            try {
              host = new URL(f.url).hostname.replace(/^www\./, "");
            } catch {
              /* keep url */
            }
            return `SOURCE ${i + 1}: "${f.title}" (from ${host})\nURL: ${f.url}\n${f.text}`;
          })
          .join("\n\n---\n\n");

        send({
          type: "status",
          step: "fetched",
          message: `Got ${usable.length} sources (${Math.round(sourceContext.length / 1000)}k chars). Writing article…`,
        });
      }

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
- NEVER invent or guess CVE IDs — only use CVE IDs that appear verbatim in the sources with their full numeric format (e.g. CVE-2026-12345). If a vulnerability has no confirmed CVE ID, write "CVE ID not yet assigned" instead of making one up.

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
- NEVER include placeholder CVE IDs (like cve-2026-xxxxx) in tags — only real, verified CVE IDs with full numeric format

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
          // Only populated for research mode — real URLs the LLM was
          // grounded on. Compose UI should pass these to publish so the
          // frontmatter.source_urls field is accurate.
          sourceUrls,
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
