#!/usr/bin/env node
/**
 * ZCyberNews AI Content Pipeline
 * Usage: npx tsx scripts/pipeline/index.ts [--max-articles=5] [--dry-run]
 *
 * Required env vars:
 *   DEEPSEEK_API_KEY  — article generation
 *   KIMI_API_KEY      — Chinese translation
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { ingestFeeds } from "./ingest-rss.js";
import { generateArticle } from "./generate-article.js";
import { translateArticle } from "./translate-article.js";
import { writeArticlePair, DuplicateArticleError } from "./write-mdx.js";
import { postProcessArticle } from "./post-process.js";
import { factCheckArticle, formatFactCheckLog } from "./fact-check.js";
import { notifyDiscord } from "./notify-discord.js";
import { flushProcessedCache, markProcessedBatch } from "../utils/cache.js";
import { limit } from "../utils/rate-limit.js";
import { storyIdentityKey } from "../utils/dedup.js";
import { routeStoriesForGeneration, type RoutedStory } from "./routing.js";
import { enrichStoriesForGeneration } from "./source-enrichment.js";
import { evaluatePublishQuality } from "./publish-quality-gate.js";
import { clusterStories } from "./story-clustering.js";
import {
  summarizeDecisionMatrix,
  writeDecisionMatrix,
  type DecisionGate,
  type DecisionMatrixEntry,
} from "./decision-matrix.js";
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";

// ── Recent titles loader (for prompt dedup context) ────────────────────────

/**
 * Return the titles of all EN articles published in the last `windowHours`.
 * Passed to the AI prompt so it can detect already-covered stories before
 * spending tokens on a full generation.
 *
 * Uses the same end-of-day UTC trick as daily-ops-digest to avoid the
 * midnight-parsing edge case where YYYY-MM-DD strings fall just outside the
 * cutoff window due to GitHub scheduling lag.
 */
function getRecentPublishedTitles(windowHours = 48): string[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const dirs = ["content/en/posts", "content/en/threat-intel"];
  const titles: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        const { data } = matter(raw);
        const iso = String(data.date ?? "");
        const effective = /^\d{4}-\d{2}-\d{2}$/.test(iso)
          ? iso + "T23:59:59Z"
          : iso;
        const t = new Date(effective).getTime();
        if (Number.isFinite(t) && t >= cutoff) {
          const title = String(data.title ?? "");
          if (title) titles.push(title);
        }
      } catch {
        // skip unreadable files
      }
    }
  }
  return titles;
}

// ── Content relevance filter ────────────────────────────────────────────────

const CYBER_KEYWORDS = [
  "security",
  "cyber",
  "vulnerability",
  "cve",
  "malware",
  "ransomware",
  "phishing",
  "exploit",
  "breach",
  "hack",
  "threat",
  "attack",
  "apt",
  "zero-day",
  "0day",
  "backdoor",
  "trojan",
  "botnet",
  "ddos",
  "firewall",
  "encryption",
  "authentication",
  "patch",
  "advisory",
  "incident",
  "credential",
  "data leak",
  "infosec",
  "siem",
  "edr",
  "soc",
  "pentest",
  "forensic",
  "compliance",
  "gdpr",
  "privacy",
  "surveillance",
  "nist",
  "cryptograph",
  "regulation",
  "governance",
  "spyware",
  "worm",
  "rootkit",
  "keylogger",
  "mitigation",
  "detection",
  "intrusion",
  "endpoint",
  "network security",
  "access control",
  "identity",
];

function isCyberSecurityRelevant(title: string, category: string): boolean {
  // threat-intel, vulnerabilities, malware categories are always relevant
  if (["threat-intel", "vulnerabilities", "malware"].includes(category))
    return true;
  const lower = title.toLowerCase();
  return CYBER_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const MAX_ARTICLES = parseInt(
  args.find((a) => a.startsWith("--max-articles="))?.split("=")[1] ?? "5",
  10,
);
const DRY_RUN = args.includes("--dry-run");
const CRITICAL_ONLY =
  args.includes("--critical-only") || process.env.CRITICAL_ONLY === "true";
const SOURCE_IDS = (process.env.SOURCE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const decisionEntries: DecisionMatrixEntry[] = [];
let decisionMatrixWritten = false;

function flushDecisionMatrix() {
  try {
    const matrix = writeDecisionMatrix(decisionEntries);
    if (!decisionMatrixWritten) {
      console.log(
        `[pipeline] Decision matrix: ${matrix.summary.published} published, ${matrix.summary.notPublished} not published`,
      );
    }
    decisionMatrixWritten = true;
  } catch (err) {
    console.error("[pipeline] Failed to write decision matrix:", err);
  }
}

function gate(
  gateName: string,
  outcome: DecisionGate["outcome"],
  detail?: string,
): DecisionGate {
  return detail
    ? { gate: gateName, outcome, detail }
    : { gate: gateName, outcome };
}

function compactReasonList(reasons: string[], fallback: string): string {
  return reasons.length > 0 ? reasons.join(", ") : fallback;
}

function articleDecisionFields(article: GeneratedArticle | null) {
  if (!article) return {};
  return {
    articleTitle: article.title,
    slug: article.slug,
    category: article.category,
    severity: article.severity ?? null,
  };
}

if (!DRY_RUN) {
  // Need at least one AI provider — OpenRouter (free) or DeepSeek/Kimi (paid)
  if (
    !process.env.OPENROUTER_API_KEY &&
    !process.env.DEEPSEEK_API_KEY &&
    !process.env.KIMI_API_KEY
  ) {
    console.error(
      "[pipeline] ❌ No AI provider configured. Set OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or KIMI_API_KEY.",
    );
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n🚀 ZCyberNews AI Pipeline — max=${MAX_ARTICLES}${DRY_RUN ? " [DRY RUN]" : ""}${CRITICAL_ONLY ? " [CRITICAL ONLY]" : ""}${SOURCE_IDS.length ? ` [sources=${SOURCE_IDS.join(",")}]` : ""}\n`,
  );

  // 1. Ingest fresh stories from RSS
  const stories = await ingestFeeds(MAX_ARTICLES * 3);
  const selectedStories =
    SOURCE_IDS.length > 0
      ? stories.filter((s) => SOURCE_IDS.includes(s.sourceId ?? ""))
      : stories;

  if (SOURCE_IDS.length > 0) {
    console.log(
      `[pipeline] Source filter enabled: ${SOURCE_IDS.join(", ")} → ${selectedStories.length}/${stories.length} stories`,
    );
  }

  if (selectedStories.length === 0) {
    console.log("[pipeline] No new stories to process. Exiting.");
    return;
  }

  const storyOrder = new Map(
    selectedStories.map((story, index) => [story, index] as const),
  );
  const routed = routeStoriesForGeneration(selectedStories);
  for (const skip of routed.skipped) {
    console.log(
      `[routing] skip ${skip.story.sourceId ?? skip.story.sourceName} ` +
        `(${skip.reason}): "${skip.story.title.slice(0, 100)}"`,
    );
    decisionEntries.push({
      index: storyOrder.get(skip.story) ?? decisionEntries.length,
      outcome: "not_published",
      sourceTitle: skip.story.title,
      sourceName: skip.story.sourceName,
      sourceUrl: skip.story.url,
      stage: "routing",
      decision: "not published",
      reasons: [skip.reason],
      gates: [
        gate("routing", "block", skip.reason),
        gate("translation", "skip", skip.decision.action),
      ],
      locale: skip.decision.action,
    });
  }
  if (routed.skipped.length > 0) {
    console.log(
      `[routing] Skipped ${routed.skipped.length}/${selectedStories.length} story/stories before generation`,
    );
  }
  const publishableStories: RoutedStory[] = routed.publishable;

  if (publishableStories.length === 0) {
    console.log("[pipeline] No publishable stories after routing. Exiting.");
    return;
  }

  // 2. Group related stories into batches of 1-3 per article.
  // Multi-source clusters get priority so public candidates start with
  // better source depth instead of single-source thin summaries.
  const clusters = clusterStories(publishableStories);
  const batches: Array<Array<RoutedStory & { clusterKey: string }>> = clusters
    .slice(0, MAX_ARTICLES)
    .map((cluster) =>
      cluster.stories.map((story) => ({
        ...story,
        clusterKey: cluster.key,
      })),
    );

  console.log(`[pipeline] Will generate ${batches.length} articles\n`);

  if (DRY_RUN) {
    console.log("[pipeline] Dry run — stories that would be processed:");
    batches.forEach((batch, i) => {
      const sources = [...new Set(batch.map((s) => s.sourceName))].join(", ");
      console.log(
        `  ${i + 1}. [${batch[0]?.clusterKey}] ${batch[0]?.title} (${sources})`,
      );
    });
    return;
  }

  // 3. Generate + translate + write — p-limit(3) concurrency
  let skippedOffTopic = 0;
  let skippedDuplicate = 0;
  let skippedFactCheck = 0;
  let skippedQuality = 0;
  let translationWarnings = 0;
  // Sub-categories for the `failed` bucket — makes the daily digest
  // actionable instead of opaque. Previously "Per-article failures: 28"
  // told us nothing about whether to tune the prompt, retry the API,
  // or fix the writer. Now we know.
  //
  //   failedGeneration: LLM returned null (timeout, 5xx, JSON parse,
  //                     schema reject in the output parser)
  //   failedException:  anything else thrown in the article promise —
  //                     post-process bug, non-duplicate write error,
  //                     translate call crash
  let failedGeneration = 0;
  let failedException = 0;

  // Load titles published in the last 48h to pass as context to the AI prompt.
  // The AI uses this list to self-reject stories it has already covered (e.g.
  // the same Patch Tuesday event from a different RSS source).
  const recentTitles = getRecentPublishedTitles(48);
  console.log(
    `[pipeline] Loaded ${recentTitles.length} recent titles for prompt dedup context`,
  );

  const results = await Promise.allSettled(
    batches.map((batch, batchIndex) =>
      limit(async () => {
        const primaryStory = batch[0];
        const baseIndex =
          (primaryStory ? storyOrder.get(primaryStory) : undefined) ??
          selectedStories.length + batchIndex;
        const sourceTitle = primaryStory?.title ?? "Untitled source story";
        const sourceName = primaryStory?.sourceName;
        const sourceUrl = primaryStory?.url;
        const translationDecision = primaryStory?.translationDecision;
        const decisionGates: DecisionGate[] = [
          gate("routing", "pass", translationDecision?.action ?? "unknown"),
        ];
        let decisionArticle: GeneratedArticle | null = null;
        let sourceCount = batch.length;

        function recordDecision(
          outcome: DecisionMatrixEntry["outcome"],
          stage: string,
          decision: string,
          reasons: string[],
          finalGate: DecisionGate,
          extraGates: DecisionGate[] = [],
          locale?: string,
        ) {
          decisionEntries.push({
            index: baseIndex,
            outcome,
            sourceTitle,
            sourceName,
            sourceUrl,
            ...articleDecisionFields(decisionArticle),
            stage,
            decision,
            reasons,
            gates: [...decisionGates, ...extraGates, finalGate],
            sourceCount,
            locale,
          });
        }

        // Outer try/catch so any uncaught exception in the article pipeline
        // (post-process crash, non-duplicate write error, translate crash,
        // Zod reject on the AI output) counts as `failedException` instead
        // of disappearing into the undifferentiated `failed` bucket.
        // Returns null on failure to keep `succeeded` counting correct.
        try {
          const sourceBatch = await enrichStoriesForGeneration(batch);
          sourceCount = sourceBatch.length;
          decisionGates.push(
            gate(
              "source-depth",
              sourceCount > 1 ? "pass" : "warn",
              `${sourceCount} source${sourceCount === 1 ? "" : "s"}`,
            ),
          );
          const storyUrls = sourceBatch.map((s) => s.url).filter(Boolean);
          const clusterKey = sourceBatch[0]?.clusterKey;
          const storyProcessedKeys = sourceBatch
            .map((s) => storyIdentityKey(s))
            .filter(Boolean);
          const startTime = Date.now();
          console.log(`[pipeline] Generating: "${batch[0]?.title}"…`);

          // Generate EN article — pass recent titles so the AI can self-reject
          // stories that are off-topic or already covered (prompt-level guard).
          const result = await generateArticle(sourceBatch, recentTitles);
          if (result === null) {
            console.warn("[pipeline] ⚠️  Generation failed, skipping.");
            failedGeneration++;
            recordDecision(
              "not_published",
              "generation",
              "not published",
              ["generation_null"],
              gate("generation", "fail", "LLM returned no article"),
            );
            console.log(
              JSON.stringify({
                event: "article_failed",
                reason: "generation_null",
                source_title: batch[0]?.title,
                source_url: batch[0]?.url,
              }),
            );
            return null;
          }
          if (result === "reject") {
            // AI determined off-topic or already covered — counts as off-topic
            skippedOffTopic++;
            recordDecision(
              "not_published",
              "generation",
              "not published",
              ["ai_reject_off_topic_or_already_covered"],
              gate(
                "generation",
                "block",
                "AI rejected as off-topic or already covered",
              ),
            );
            markProcessedBatch(storyProcessedKeys);
            return null;
          }
          const article = result;
          decisionArticle = article;
          decisionGates.push(
            gate(
              "generation",
              "pass",
              `${article.category}/${article.severity ?? "unset"}`,
            ),
          );

          // Post-generation content relevance filter — belt-and-suspenders check
          // in case the AI didn't reject but still produced off-topic output.
          if (!isCyberSecurityRelevant(article.title, article.category)) {
            console.warn(
              `[pipeline] ⚠️  Off-topic article rejected: "${article.title}" (category: ${article.category})`,
            );
            skippedOffTopic++;
            recordDecision(
              "not_published",
              "relevance",
              "not published",
              ["not_cybersecurity_relevant"],
              gate(
                "relevance",
                "block",
                `title/category failed relevance check (${article.category})`,
              ),
            );
            markProcessedBatch(storyProcessedKeys); // Still mark as processed to avoid retrying
            return null;
          }
          decisionGates.push(gate("relevance", "pass"));

          // Post-process — script overrides LLM output for structured fields
          // (slug, date, cve_ids, iocs). Script-derived = deterministic = no
          // hallucination possible on these fields. "LLM writes prose, script
          // extracts structured data."
          postProcessArticle(article, sourceBatch);

          // Fact-check — regex-based cross-validation of claims against source
          // material. HIGH severity issues block publish. MEDIUM/LOW logged
          // but allowed through. Runs after post-process because post-process
          // may have fixed some issues by filtering invented CVEs.
          const fc = await factCheckArticle(article, sourceBatch);
          console.log(`[pipeline] ${formatFactCheckLog(fc)}`);
          if (!fc.passed) {
            const highIssueTypes = fc.issues
              .filter((i) => i.severity === "high")
              .map((i) => i.type);
            console.warn(
              `[pipeline] ❌ Fact-check rejected "${article.title}" — ${highIssueTypes.length} high-severity issues`,
            );
            skippedFactCheck++;
            recordDecision(
              "not_published",
              "fact-check",
              "not published",
              highIssueTypes.length > 0
                ? highIssueTypes
                : ["fact_check_failed"],
              gate(
                "fact-check",
                "block",
                compactReasonList(highIssueTypes, "high-severity issue"),
              ),
            );
            markProcessedBatch(storyProcessedKeys);
            return null;
          }
          const fcWarnings = fc.issues.filter((i) => i.severity !== "high");
          decisionGates.push(
            gate(
              "fact-check",
              fcWarnings.length > 0 ? "warn" : "pass",
              fcWarnings.length > 0
                ? `${fcWarnings.length} non-blocking issue(s)`
                : undefined,
            ),
          );

          if (CRITICAL_ONLY && article.severity !== "critical") {
            console.log(
              `[pipeline] Skipping non-critical article in critical-only mode: "${article.title}" (severity=${article.severity ?? "unset"})`,
            );
            skippedQuality++;
            recordDecision(
              "not_published",
              "critical-only",
              "not published",
              [`severity_${article.severity ?? "unset"}`],
              gate(
                "critical-only",
                "block",
                `severity=${article.severity ?? "unset"}`,
              ),
            );
            markProcessedBatch(storyProcessedKeys);
            return null;
          }
          if (CRITICAL_ONLY) decisionGates.push(gate("critical-only", "pass"));

          // Publish quality gate — deterministic scorer, shared with the
          // daily audit and digest guard. This blocks articles that are
          // technically valid but would damage reader trust if published:
          // serious flags, no References section, or threat-intel/vuln
          // pieces with thin structured fields.
          const qualityDecision = evaluatePublishQuality(article, storyUrls);
          if (!qualityDecision.allowed) {
            const blockingCodes = qualityDecision.blockingFlags.map(
              (f) => f.code,
            );
            console.warn(
              `[pipeline] ❌ Quality gate rejected "${article.title}" — ${blockingCodes.join(", ")}`,
            );
            console.log(
              JSON.stringify({
                event: "article_blocked_quality",
                slug: article.slug,
                title: article.title,
                category: article.category,
                headline_score: qualityDecision.score.headlineScore,
                word_count: qualityDecision.score.wordCount,
                structured_richness: qualityDecision.score.structuredRichness,
                blocking_flags: blockingCodes,
                all_flags: qualityDecision.score.flags.map((f) => ({
                  code: f.code,
                  severity: f.severity,
                })),
                source_title: batch[0]?.title,
                source_url: batch[0]?.url,
              }),
            );
            skippedQuality++;
            recordDecision(
              "not_published",
              "quality",
              "not published",
              blockingCodes,
              gate(
                "quality",
                "block",
                compactReasonList(blockingCodes, "blocking quality flag"),
              ),
            );
            markProcessedBatch(storyProcessedKeys);
            return null;
          }
          const qualityWarnings = qualityDecision.score.flags
            .filter(
              (flag) =>
                !qualityDecision.blockingFlags.some(
                  (blocking) => blocking.code === flag.code,
                ),
            )
            .map((flag) => flag.code);
          decisionGates.push(
            gate(
              "quality",
              qualityWarnings.length > 0 ? "warn" : "pass",
              [
                `headline=${qualityDecision.score.headlineScore}`,
                `words=${qualityDecision.score.wordCount}`,
                qualityWarnings.length > 0
                  ? `warnings=${qualityWarnings.slice(0, 3).join(",")}`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            ),
          );

          const shouldTranslate =
            translationDecision?.action === "translate-and-publish-both";
          let zhMeta = null;
          if (shouldTranslate) {
            // Translate to ZH
            console.log(`[pipeline] Translating: "${article.title}"…`);
            zhMeta = await translateArticle(article);
          } else {
            console.log(
              `[pipeline] Translation skipped by routing (${translationDecision?.action ?? "unknown"})`,
            );
          }

          // Translation quality gate
          if (zhMeta) {
            const bodyRatio = zhMeta.body.length / article.body.length;
            const hasMainlyChinese = /[\u4e00-\u9fff]/.test(zhMeta.body);
            const tooShort = zhMeta.body.length < 100;

            if (tooShort || !hasMainlyChinese || bodyRatio < 0.3) {
              console.warn(
                `[pipeline] ⚠️  Translation quality check failed (ratio=${bodyRatio.toFixed(2)}, chinese=${hasMainlyChinese}, len=${zhMeta.body.length}). Publishing EN only.`,
              );
              zhMeta = null;
              translationWarnings++;
              decisionGates.push(
                gate(
                  "translation",
                  "warn",
                  `downgraded to EN only (ratio=${bodyRatio.toFixed(2)})`,
                ),
              );
            }
          }
          if (zhMeta) {
            decisionGates.push(gate("translation", "pass", "en+zh"));
          } else if (!shouldTranslate) {
            decisionGates.push(
              gate(
                "translation",
                "skip",
                translationDecision?.action ?? "unknown",
              ),
            );
          }

          // Write MDX files (with shift-right duplicate check)
          let paths: { en: string; zh: string | null };
          try {
            paths = writeArticlePair(article, zhMeta, storyUrls, {
              clusterKey,
              sourceCount: storyUrls.length,
            });
          } catch (err) {
            if (err instanceof DuplicateArticleError) {
              // SHIFT-RIGHT TRIPPED: article passed RSS-side dedup but the
              // generated output matches an existing article on disk. Skip
              // write, mark sources as processed (so we don't retry next
              // run), and emit a structured log so we can monitor frequency.
              console.warn(
                `[pipeline] 🛡️  DUPLICATE BLOCKED: "${article.title}" — ${err.message}`,
              );
              console.log(
                JSON.stringify({
                  event: "article_blocked_duplicate",
                  attempted_slug: err.attemptedSlug,
                  attempted_title: err.attemptedTitle,
                  matched_slug: err.duplicate.matchedSlug,
                  matched_title: err.duplicate.matchedTitle,
                  match_type: err.duplicate.matchType,
                  similarity: err.duplicate.similarity,
                }),
              );
              skippedDuplicate++;
              recordDecision(
                "not_published",
                "duplicate",
                "not published",
                [`duplicate_${err.duplicate.matchType}`],
                gate(
                  "duplicate",
                  "block",
                  `${err.duplicate.matchType} match: ${err.duplicate.matchedTitle}`,
                ),
              );
              markProcessedBatch(storyProcessedKeys);
              return null;
            }
            throw err;
          }

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);

          // Structured log line
          console.log(
            JSON.stringify({
              event: "article_written",
              slug: article.slug,
              category: article.category,
              locale: zhMeta ? "en+zh" : "en",
              duration_s: duration,
              word_count: article.body.split(/\s+/).length,
            }),
          );

          console.log(`[pipeline] ✅  Written: ${paths.en} (${duration}s)`);
          if (paths.zh) console.log(`[pipeline] ✅  Written: ${paths.zh}`);
          recordDecision(
            "published",
            "write",
            "published",
            ["passed publish gates"],
            gate("write", "pass", zhMeta && paths.zh ? "en+zh" : "en"),
            [gate("duplicate", "pass", "no duplicate found")],
            zhMeta && paths.zh ? "en+zh" : "en",
          );

          // Discord notification — fire-and-forget. Posts to #en-news-feed
          // (and #zh-news-feed if ZH translation shipped). Silent skip if
          // DISCORD_WEBHOOK_{EN,ZH} env vars aren't set. Never blocks or
          // fails the pipeline on Discord errors.
          const section: "posts" | "threat-intel" =
            article.category === "threat-intel" ? "threat-intel" : "posts";
          notifyDiscord(article, "en", section).catch((e) =>
            console.warn("[discord] en unexpected error:", e),
          );
          if (zhMeta && paths.zh) {
            // Build a ZH-titled version for the ZH channel
            const zhArticle = {
              ...article,
              title: zhMeta.title || article.title,
              excerpt: zhMeta.excerpt || article.excerpt,
            };
            notifyDiscord(zhArticle, "zh", section).catch((e) =>
              console.warn("[discord] zh unexpected error:", e),
            );
          }

          // Mark source URLs as processed
          markProcessedBatch(storyProcessedKeys);

          return { article, paths };
        } catch (err) {
          // Any unhandled exception in article processing — post-process
          // crash, translate call throw, write error that isn't
          // DuplicateArticleError, Discord/fetch rejection that escaped.
          // Categorized separately so the daily digest surfaces a real
          // cause instead of a mystery "failed" count.
          failedException++;
          console.error("[pipeline] ❌ Unhandled article error:", err);
          recordDecision(
            "not_published",
            "exception",
            "not published",
            [err instanceof Error ? err.message : String(err)],
            gate(
              "exception",
              "fail",
              err instanceof Error ? err.message : String(err),
            ),
          );
          console.log(
            JSON.stringify({
              event: "article_failed",
              reason: "exception",
              source_title: batch[0]?.title,
              source_url: batch[0]?.url,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          return null;
        }
      }),
    ),
  );

  // 4. Summary
  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value,
  ).length;
  // `failed` is the total of the two explicit buckets (generation-null
  // and uncaught exception) plus any residual promise rejections that
  // escaped the outer try/catch (should be zero now, but kept for
  // forward-compat so the math still balances if a new failure mode
  // sneaks in without classification).
  const classifiedFailed = failedGeneration + failedException;
  const unclassifiedFailed = Math.max(
    0,
    results.length -
      succeeded -
      skippedOffTopic -
      skippedDuplicate -
      skippedFactCheck -
      skippedQuality -
      classifiedFailed,
  );
  const failed = classifiedFailed + unclassifiedFailed;

  console.log(
    `\n📊 Pipeline complete: ${succeeded} written, ${skippedDuplicate} duplicates blocked, ${skippedOffTopic} off-topic rejected, ${skippedFactCheck} fact-check rejected, ${skippedQuality} quality rejected, ${translationWarnings} translation warnings, ${failed} failed (gen=${failedGeneration} exc=${failedException} unk=${unclassifiedFailed})\n`,
  );

  const decisionSummary = summarizeDecisionMatrix(decisionEntries);

  // Write run summary as JSON
  console.log(
    JSON.stringify({
      event: "pipeline_complete",
      timestamp:
        new Date().toLocaleString("en-GB", { timeZone: "Asia/Singapore" }) +
        " SGT",
      articles_written: succeeded,
      duplicates_blocked: skippedDuplicate,
      off_topic_rejected: skippedOffTopic,
      fact_check_rejected: skippedFactCheck,
      quality_rejected: skippedQuality,
      translation_warnings: translationWarnings,
      failed,
      // Sub-category breakdown — surfaced in daily digest for debugging.
      failed_generation: failedGeneration,
      failed_exception: failedException,
      failed_unclassified: unclassifiedFailed,
      decision_matrix: decisionSummary,
    }),
  );

  flushDecisionMatrix();
  flushProcessedCache();
  if (failed > 0) process.exit(1);
}

function flushBeforeExit() {
  flushDecisionMatrix();
  try {
    flushProcessedCache();
  } catch (err) {
    console.error("[pipeline] Failed to flush processed cache:", err);
  }
}

process.once("SIGINT", () => {
  flushBeforeExit();
  process.exit(130);
});

process.once("SIGTERM", () => {
  flushBeforeExit();
  process.exit(143);
});

main()
  .then(() => {
    flushBeforeExit();
    // Force exit even if pending async handles (e.g., undici keep-alive
    // sockets from failed OpenRouter retries) would otherwise keep the
    // Node event loop alive. Without this, the pipeline process hangs
    // after logging "pipeline_complete" because ~30+ HTTP connections
    // to rate-limited free models remain in the connection pool.
    // GitHub Actions doesn't progress to the next step until tsx exits.
    process.exit(0);
  })
  .catch((err) => {
    console.error("[pipeline] Fatal error:", err);
    flushBeforeExit();
    process.exit(1);
  });
