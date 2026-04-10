#!/usr/bin/env node
/**
 * AleCyberNews AI Content Pipeline
 * Usage: npx tsx scripts/pipeline/index.ts [--max-articles=5] [--dry-run]
 *
 * Required env vars:
 *   DEEPSEEK_API_KEY  — article generation
 *   KIMI_API_KEY      — Chinese translation
 */

import { ingestFeeds } from "./ingest-rss.js";
import { generateArticle } from "./generate-article.js";
import { translateArticle } from "./translate-article.js";
import { writeArticlePair } from "./write-mdx.js";
import { markProcessedBatch } from "../utils/cache.js";
import { limit } from "../utils/rate-limit.js";

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
  assertEnv("DEEPSEEK_API_KEY");
  assertEnv("KIMI_API_KEY");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n🚀 AleCyberNews AI Pipeline — max=${MAX_ARTICLES}${DRY_RUN ? " [DRY RUN]" : ""}\n`,
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
  const results = await Promise.allSettled(
    batches.map((batch) =>
      limit(async () => {
        const storyUrls = batch.map((s) => s.url).filter(Boolean);
        console.log(`[pipeline] Generating: "${batch[0]?.title}"…`);

        // Generate EN article
        const article = await generateArticle(batch);
        if (!article) {
          console.warn("[pipeline] ⚠️  Generation failed, skipping.");
          return null;
        }

        // Translate to ZH
        console.log(`[pipeline] Translating: "${article.title}"…`);
        const zhMeta = await translateArticle(article);

        // Write MDX files
        const paths = writeArticlePair(article, zhMeta);
        console.log(`[pipeline] ✅  Written: ${paths.en}`);
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
  const failed = results.length - succeeded;

  console.log(
    `\n📊 Pipeline complete: ${succeeded} articles written, ${failed} failed\n`,
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[pipeline] Fatal error:", err);
  process.exit(1);
});
