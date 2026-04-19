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

// Word count guidance — length targets paired with anti-filler discipline.
// Updated 2026-04-19 after corpus analysis showed LLM delivers floor of
// stated range, not middle. Each preset now explicitly frames the range
// AND tells the model not to pad when source is thin.
const ANTI_FILLER_CLAUSE =
  "DO NOT pad to hit the upper bound if source material does not support it. A tight shorter article beats a bloated one with filler, speculation, or marketing-style closers. If a section has no source support, write 'None identified in source material' — never invent generic best-practices.";

const WORD_COUNT_GUIDANCE = {
  short: {
    label: "400–600",
    instruction: `400–600 words. Concise and dense. ${ANTI_FILLER_CLAUSE}`,
  },
  medium: {
    label: "900–1300",
    instruction: `900–1300 words — the honest default. ${ANTI_FILLER_CLAUSE}`,
  },
  long: {
    label: "1800–2800",
    instruction: `1800–2800 words — exhaustive deep dive covering every technical detail the sources provide. Rich IOC/TTP analysis, full threat actor context, detailed mitigation recommendations tied to the specific threat. ${ANTI_FILLER_CLAUSE}`,
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
      // stream granular progress events to the UI (better operator UX
      // than a silent 15s wait).
      if (deferredResearchKeywords) {
        // Step 1 — announce search intent
        send({
          type: "status",
          step: "searching",
          message: `🔍 Searching Brave for "${deferredResearchKeywords}"…`,
        });

        let searchResults;
        const searchStart = Date.now();
        try {
          // No freshness filter — niche cybersecurity coverage (e.g.
          // "thegentlemen ransomware" on dexpose.io, hookphish.com) often
          // lacks proper date metadata, so Brave's freshness filter hides
          // them. We rely on the keyword-match quality filter below to
          // reject off-topic matches instead.
          searchResults = await searchBrave(deferredResearchKeywords, {
            count: 8,
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

        const searchMs = Date.now() - searchStart;

        if (searchResults.length < 2) {
          send({
            type: "error",
            message: `Only ${searchResults.length} search result(s) found. Try different or broader keywords.`,
          });
          writer.close();
          return;
        }

        // Step 2 — report what we got back, list the domains
        const resultHosts = searchResults.slice(0, 8).map((r) => {
          try {
            return new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            return r.url;
          }
        });
        send({
          type: "status",
          step: "search-complete",
          message: `✓ Found ${searchResults.length} results (${searchMs}ms) — ${resultHosts.slice(0, 5).join(", ")}${resultHosts.length > 5 ? ", …" : ""}`,
        });

        // Step 3 — announce fetching phase
        // Cap at 5 fetches to keep total latency <15s and respect site load
        const toFetch = searchResults.slice(0, 5);
        send({
          type: "status",
          step: "fetching",
          message: `📥 Fetching ${toFetch.length} top sources in parallel…`,
        });

        // Step 4 — per-article completion events
        // Use a settled Promise pattern so we can report each fetch outcome
        // as it resolves instead of waiting for the whole batch.
        const fetched = await Promise.all(
          toFetch.map(async (r, idx) => {
            const host = (() => {
              try {
                return new URL(r.url).hostname.replace(/^www\./, "");
              } catch {
                return r.url;
              }
            })();
            const result = await fetchArticle(r.url, 10_000);
            if (result.error) {
              send({
                type: "status",
                step: "fetch-item",
                message: `  ✗ ${host} — ${result.error}`,
              });
            } else {
              send({
                type: "status",
                step: "fetch-item",
                message: `  ✓ ${host} — ${Math.round(result.text.length / 1000)}k chars`,
              });
            }
            return { ...result, idx };
          }),
        );
        const extractable = fetched.filter(
          (f) => !f.error && f.text.length >= 300,
        );

        // ── Quality filter: keyword-match score ─────────────────────────
        // Protect LLM generation from off-topic sources (e.g. Brave returns
        // an NBA article matching "Shiny Hunters"). Pure deterministic
        // filter — no LLM tokens spent. A source must contain ≥60% of the
        // query keywords (≥3 chars) to pass. Below that, it's tangential.
        const queryTokens = deferredResearchKeywords
          .toLowerCase()
          .split(/\s+/)
          .map((t) => t.replace(/[^a-z0-9]/g, ""))
          .filter((t) => t.length >= 3);
        const matchThreshold = Math.max(2, Math.ceil(queryTokens.length * 0.6));

        send({
          type: "status",
          step: "filtering",
          message: `🧪 Quality filter: checking sources match [${queryTokens.join(", ")}] (≥${matchThreshold} of ${queryTokens.length} keywords)…`,
        });

        const usable: typeof extractable = [];
        const discarded: { host: string; matched: number; total: number }[] =
          [];
        for (const src of extractable) {
          // Count how many query tokens appear in the (lowercased) text
          const lowText = src.text.toLowerCase();
          const matched = queryTokens.filter((tok) =>
            lowText.includes(tok),
          ).length;
          let host = src.url;
          try {
            host = new URL(src.url).hostname.replace(/^www\./, "");
          } catch {
            /* keep url */
          }
          if (matched >= matchThreshold) {
            usable.push(src);
            send({
              type: "status",
              step: "filter-keep",
              message: `  ✓ ${host} — matched ${matched}/${queryTokens.length} keywords`,
            });
          } else {
            discarded.push({ host, matched, total: queryTokens.length });
            send({
              type: "status",
              step: "filter-discard",
              message: `  ✗ ${host} — discarded (only ${matched}/${queryTokens.length} keywords matched)`,
            });
          }
        }

        // Minimum 3 sources (was 2) — triangulation standard for journalism.
        // If keyword filter was too strict (e.g. query used stopwords),
        // fall back to extractable sources to avoid rejecting a valid run.
        const MIN_SOURCES = 3;
        if (usable.length < MIN_SOURCES) {
          const fetchErrs = fetched
            .filter((f) => f.error)
            .map((f) => {
              try {
                return `${new URL(f.url).hostname}: ${f.error}`;
              } catch {
                return `${f.url}: ${f.error}`;
              }
            })
            .slice(0, 3)
            .join("; ");
          const discardedSummary =
            discarded.length > 0
              ? `${discarded.length} discarded as off-topic`
              : "";
          // Actionable recovery hints based on WHY it failed:
          // - 0 matches AND Brave returned results → probably a typo
          //   (e.g. "Adaptivist" when correct is "Adaptavist"). Operator
          //   sees the returned domains and can recheck spelling.
          // - Some matches but below threshold → genuinely niche; broaden
          //   keywords or paste mode.
          // - All fetch failures → sites block bots; paste mode.
          let hint: string;
          if (searchResults.length > 0 && usable.length === 0) {
            // Show the actual domains Brave returned so operator can spot
            // a typo at a glance (e.g. results are about "Adaptavist" but
            // query said "Adaptivist").
            const returnedDomains = searchResults
              .slice(0, 6)
              .map((r) => {
                try {
                  return new URL(r.url).hostname.replace(/^www\./, "");
                } catch {
                  return r.url;
                }
              })
              .join(", ");
            hint = `Possible TYPO — Brave returned ${searchResults.length} results (${returnedDomains}) but none contained your keywords verbatim. Check spelling of the threat actor / victim name.`;
          } else if (fetched.every((f) => f.error)) {
            hint =
              "All sources blocked or timed out. Paste mode is more reliable for bot-blocked sites.";
          } else {
            hint = "Try more specific keywords or paste mode.";
          }
          send({
            type: "error",
            message: `Only ${usable.length}/${MIN_SOURCES} sources matched your keywords. ${discardedSummary}${fetchErrs ? `. Fetch failures: ${fetchErrs}` : ""}. ${hint}`,
          });
          writer.close();
          return;
        }

        // Step 5 — assemble context, announce the handoff to the LLM
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
          step: "analyzing",
          message: `🧠 Analyzing ${usable.length} sources (${Math.round(sourceContext.length / 1000)}k chars) — checking for duplicates, extracting facts…`,
        });
      }

      // Step 6 — hand off to the LLM. This is the longest phase (~30s).
      // Tell the operator who we're calling and what we're asking for.
      const providerLabel =
        provider === "auto"
          ? "free model → DeepSeek fallback"
          : provider === "deepseek"
            ? "DeepSeek (paid)"
            : "Kimi (paid)";
      send({
        type: "status",
        step: "writing",
        message: `✍️ Calling ${providerLabel} — writing ${wc.label}-word article (this takes ~20-40s)…`,
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

      const bodyWordCount = articleBody.trim().split(/\s+/).length;
      send({
        type: "status",
        step: "body-done",
        message: `✓ Article written — ${bodyWordCount} words (${bodyModel.split("/").pop()}${bodyWasPaid ? " — paid" : " — free"})`,
        model: bodyModel,
      });
      send({
        type: "status",
        step: "metadata",
        message: `🏷️ Generating SEO metadata — title, slug, excerpt, tags…`,
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

      // One last status event BEFORE "done" so the log shows finality
      send({
        type: "status",
        step: "finalizing",
        message: `✓ Metadata ready — "${aiTitle.slice(0, 60)}${aiTitle.length > 60 ? "…" : ""}" · ${aiCategory} · ${aiTags.length} tags`,
        model: metaModel,
      });

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
