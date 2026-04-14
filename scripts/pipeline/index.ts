#!/usr/bin/env node
/**
 * ZCyberNews AI Content Pipeline
 * Usage: npx tsx scripts/pipeline/index.ts [--max-articles=5] [--dry-run]
 *
 * Required env vars:
 *   DEEPSEEK_API_KEY  — article generation
 *   KIMI_API_KEY      — Chinese translation
 */

import { ingestFeeds } from "./ingest-rss.js";
import { generateArticle } from "./generate-article.js";
import { translateArticle } from "./translate-article.js";
import { writeArticlePair, DuplicateArticleError } from "./write-mdx.js";
import { markProcessedBatch } from "../utils/cache.js";
import { limit } from "../utils/rate-limit.js";

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

// ── Validation ────────────────────────────────────────────────────────────────

function assertEnv(key: string) {
  if (!process.env[key]) {
    console.error(`[pipeline] ❌ Missing required env var: ${key}`);
    process.exit(1);
  }
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
    `\n🚀 ZCyberNews AI Pipeline — max=${MAX_ARTICLES}${DRY_RUN ? " [DRY RUN]" : ""}\n`,
  );

  // 1. Ingest fresh stories from RSS
  const stories = await ingestFeeds(MAX_ARTICLES * 3);

  if (stories.length === 0) {
    console.log("[pipeline] No new stories to process. Exiting.");
    return;
  }

  // 2. Group stories into batches of 1-3 per article
  //    (single high-value stories get their own article; related ones get merged)
  const batches: (typeof stories)[] = [];
  const remaining = [...stories];
  while (remaining.length > 0 && batches.length < MAX_ARTICLES) {
    // Take 1 story per article for now (safest for quality)
    batches.push([remaining.shift()!]);
  }

  console.log(`[pipeline] Will generate ${batches.length} articles\n`);

  if (DRY_RUN) {
    console.log("[pipeline] Dry run — stories that would be processed:");
    batches.forEach((batch, i) => {
      console.log(`  ${i + 1}. ${batch[0]?.title} (${batch[0]?.sourceName})`);
    });
    return;
  }

  // 3. Generate + translate + write — p-limit(3) concurrency
  let skippedOffTopic = 0;
  let skippedDuplicate = 0;
  let translationWarnings = 0;

  const results = await Promise.allSettled(
    batches.map((batch) =>
      limit(async () => {
        const storyUrls = batch.map((s) => s.url).filter(Boolean);
        const startTime = Date.now();
        console.log(`[pipeline] Generating: "${batch[0]?.title}"…`);

        // Generate EN article
        const article = await generateArticle(batch);
        if (!article) {
          console.warn("[pipeline] ⚠️  Generation failed, skipping.");
          return null;
        }

        // Content relevance filter — reject off-topic articles
        if (!isCyberSecurityRelevant(article.title, article.category)) {
          console.warn(
            `[pipeline] ⚠️  Off-topic article rejected: "${article.title}" (category: ${article.category})`,
          );
          skippedOffTopic++;
          markProcessedBatch(storyUrls); // Still mark as processed to avoid retrying
          return null;
        }

        // Translate to ZH
        console.log(`[pipeline] Translating: "${article.title}"…`);
        let zhMeta = await translateArticle(article);

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
          }
        }

        // Write MDX files (with shift-right duplicate check)
        let paths: { en: string; zh: string | null };
        try {
          paths = writeArticlePair(article, zhMeta, storyUrls);
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
            markProcessedBatch(storyUrls);
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

        // Mark source URLs as processed
        markProcessedBatch(storyUrls);

        return { article, paths };
      }),
    ),
  );

  // 4. Summary
  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value,
  ).length;
  const failed =
    results.length - succeeded - skippedOffTopic - skippedDuplicate;

  console.log(
    `\n📊 Pipeline complete: ${succeeded} written, ${skippedDuplicate} duplicates blocked, ${skippedOffTopic} off-topic rejected, ${translationWarnings} translation warnings, ${failed} failed\n`,
  );

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
      translation_warnings: translationWarnings,
      failed,
    }),
  );

  if (failed > 0) process.exit(1);
}

main()
  .then(() => {
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
    process.exit(1);
  });
