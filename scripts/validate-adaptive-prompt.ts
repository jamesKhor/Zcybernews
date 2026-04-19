/**
 * Validation harness for the adaptive length + anti-filler prompt.
 *
 * Generates N real articles against fresh RSS stories using the new
 * prompt, then scans each for:
 *   1. Correct source-richness classification (which tier triggered)
 *   2. Actual body length vs target range (floor/mid/ceiling vs target)
 *   3. Fact-check result from the existing pipeline layer (CVE/IOC/actor
 *      cross-validation against source material)
 *   4. Anti-filler phrase violations (banned phrases from the new prompt)
 *   5. Generic closer / marketing wrap-up detection (last paragraph scan)
 *
 * Does NOT write to content/. Does NOT commit anything. Pure read-only
 * validation — safe to run repeatedly.
 *
 * Usage:
 *   npx tsx scripts/validate-adaptive-prompt.ts               # default 6 articles
 *   npx tsx scripts/validate-adaptive-prompt.ts --count=4
 *
 * Interprets exit code 0 = all articles pass fact-check; 1 = at least
 * one article failed fact-check (same contract as the production
 * pipeline so this can be wired into a GitHub Actions eval later).
 */
import { ingestFeeds } from "./pipeline/ingest-rss.js";
import { generateArticle } from "./pipeline/generate-article.js";
import { factCheckArticle } from "./pipeline/fact-check.js";
import { postProcessArticle } from "./pipeline/post-process.js";
import type { Story } from "./utils/dedup.js";
import type { GeneratedArticle } from "./ai/schemas/article-schema.js";

// ── Anti-filler phrase bank (must stay in sync with the prompt's
// BANNED phrases block in scripts/ai/prompts/article.ts). ─────────────

const BANNED_HEDGE_PHRASES = [
  "could potentially",
  "might theoretically",
  "in some cases",
  "it is believed that",
  "it is thought that",
  "some experts believe",
  "many security researchers believe",
];

const BANNED_CLOSER_PHRASES = [
  "organizations must stay vigilant",
  "cybersecurity is a shared responsibility",
  "as threats evolve",
  "it is crucial for organizations",
  "in today's threat landscape",
  "in an ever-changing threat",
  "proactive approach to security",
];

// ── Small helpers ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const COUNT = Number(
  args.find((a) => a.startsWith("--count="))?.split("=")[1] ?? "6",
);

function classifyRichness(batch: Story[]): "medium" | "long" | "extended" {
  const chars = batch.reduce(
    (n, s) => n + (s.title?.length ?? 0) + (s.excerpt?.length ?? 0),
    0,
  );
  if (chars < 800) return "medium";
  if (chars < 2500) return "long";
  return "extended";
}

function wordCount(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

function scanBannedPhrases(
  body: string,
  bank: string[],
): { phrase: string; snippet: string }[] {
  const hits: { phrase: string; snippet: string }[] = [];
  const lower = body.toLowerCase();
  for (const p of bank) {
    const idx = lower.indexOf(p);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(body.length, idx + p.length + 40);
      hits.push({ phrase: p, snippet: `…${body.slice(start, end)}…` });
    }
  }
  return hits;
}

/**
 * Tail-paragraph marketing closer detection — heuristic. Checks if the
 * last narrative paragraph (before References) reads as a generic
 * wrap-up rather than technical content.
 */
function detectMarketingCloser(body: string): string | null {
  // Strip References section if present
  const refIdx = body.indexOf("## References");
  const main = refIdx >= 0 ? body.slice(0, refIdx) : body;
  const paragraphs = main
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p && !p.startsWith("#") && !p.startsWith("-") && !p.startsWith("*"),
    );
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return null;
  const lower = last.toLowerCase();
  const markers = [
    "stay vigilant",
    "shared responsibility",
    "as threats evolve",
    "ever-changing",
    "threat landscape continues",
    "must adapt",
    "in conclusion",
    "to conclude",
  ];
  for (const m of markers) {
    if (lower.includes(m)) return last.slice(0, 200);
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n🧪 Adaptive-prompt validation — generating ${COUNT} articles (no writes)\n`,
  );

  // 1. Ingest fresh stories
  const stories = await ingestFeeds(COUNT * 3);
  if (stories.length === 0) {
    console.log("No stories available. Check RSS sources.");
    process.exit(1);
  }

  // 2. Form batches (mirror production — 1 story per article for now)
  const batches: Story[][] = stories.slice(0, COUNT).map((s) => [s]);

  console.log(`Stories picked (${batches.length}):`);
  batches.forEach((b, i) => {
    const chars = b.reduce(
      (n, s) => n + (s.title?.length ?? 0) + (s.excerpt?.length ?? 0),
      0,
    );
    console.log(
      `  ${i + 1}. [${chars}ch ${classifyRichness(b)}] ${b[0]?.title}`,
    );
  });
  console.log();

  // 3. Generate each article sequentially (easier to read log output)
  type Row = {
    idx: number;
    title: string;
    sourceChars: number;
    richness: "medium" | "long" | "extended";
    expectedRange: string;
    actualWords: number;
    factCheckPass: boolean | null;
    factCheckHigh: number;
    factCheckMedium: number;
    bannedHedges: { phrase: string; snippet: string }[];
    bannedClosers: { phrase: string; snippet: string }[];
    marketingCloser: string | null;
    rejectedAsOffTopic: boolean;
    generationFailed: boolean;
  };

  const results: Row[] = [];
  const EXPECTED_BY_TIER = {
    medium: "800-1200 words",
    long: "1500-2200 words",
    extended: "2000-3000 words",
  };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const richness = classifyRichness(batch);
    const sourceChars = batch.reduce(
      (n, s) => n + (s.title?.length ?? 0) + (s.excerpt?.length ?? 0),
      0,
    );
    console.log(
      `\n── [${i + 1}/${batches.length}] Generating (${richness}, ${sourceChars}ch): "${batch[0]?.title}"`,
    );

    const row: Row = {
      idx: i + 1,
      title: batch[0]?.title ?? "",
      sourceChars,
      richness,
      expectedRange: EXPECTED_BY_TIER[richness],
      actualWords: 0,
      factCheckPass: null,
      factCheckHigh: 0,
      factCheckMedium: 0,
      bannedHedges: [],
      bannedClosers: [],
      marketingCloser: null,
      rejectedAsOffTopic: false,
      generationFailed: false,
    };

    const gen = await generateArticle(batch, []);
    if (gen === null) {
      row.generationFailed = true;
      results.push(row);
      console.log(`   ❌ generation failed`);
      continue;
    }
    if (gen === "reject") {
      row.rejectedAsOffTopic = true;
      results.push(row);
      console.log(`   ⊘ AI rejected as off-topic`);
      continue;
    }

    const article = gen as GeneratedArticle;
    // Apply same post-process we run in production, so CVE IDs /
    // threat_actor derivation matches what fact-check will see.
    postProcessArticle(article, batch);

    row.actualWords = wordCount(article.body);
    row.bannedHedges = scanBannedPhrases(article.body, BANNED_HEDGE_PHRASES);
    row.bannedClosers = scanBannedPhrases(article.body, BANNED_CLOSER_PHRASES);
    row.marketingCloser = detectMarketingCloser(article.body);

    const fc = await factCheckArticle(article, batch);
    row.factCheckPass = fc.passed;
    row.factCheckHigh = fc.issues.filter((x) => x.severity === "high").length;
    row.factCheckMedium = fc.issues.filter(
      (x) => x.severity === "medium",
    ).length;

    console.log(
      `   ✓ generated ${row.actualWords}w, fact-check=${fc.passed ? "PASS" : "FAIL"} (${row.factCheckHigh}h/${row.factCheckMedium}m), hedges=${row.bannedHedges.length}, closers=${row.bannedClosers.length + (row.marketingCloser ? 1 : 0)}`,
    );

    results.push(row);
  }

  // 4. Summary report
  console.log(`\n\n▰▰▰ Validation report ▰▰▰\n`);
  console.log(
    `${"#".padEnd(3)} ${"tier".padEnd(10)} ${"words".padEnd(7)} ${"target".padEnd(16)} ${"fc".padEnd(6)} ${"hedge".padEnd(6)} ${"close".padEnd(6)} title`,
  );
  console.log("─".repeat(110));
  for (const r of results) {
    const factCheckCell = r.generationFailed
      ? "FAIL_GEN"
      : r.rejectedAsOffTopic
        ? "REJECT"
        : r.factCheckPass
          ? "PASS"
          : `FAIL(${r.factCheckHigh})`;
    const closerCount = r.bannedClosers.length + (r.marketingCloser ? 1 : 0);
    console.log(
      `${String(r.idx).padEnd(3)} ${r.richness.padEnd(10)} ${String(r.actualWords).padEnd(7)} ${r.expectedRange.padEnd(16)} ${factCheckCell.padEnd(6)} ${String(r.bannedHedges.length).padEnd(6)} ${String(closerCount).padEnd(6)} ${r.title.slice(0, 50)}`,
    );
  }

  // 5. Aggregate verdict
  const generated = results.filter(
    (r) => !r.generationFailed && !r.rejectedAsOffTopic,
  );
  const pass = generated.filter((r) => r.factCheckPass).length;
  const totalHedge = generated.reduce((n, r) => n + r.bannedHedges.length, 0);
  const totalCloser = generated.reduce(
    (n, r) => n + r.bannedClosers.length + (r.marketingCloser ? 1 : 0),
    0,
  );
  const avgWords = generated.length
    ? Math.round(
        generated.reduce((n, r) => n + r.actualWords, 0) / generated.length,
      )
    : 0;

  console.log(`\nAggregates:`);
  console.log(`  Generated: ${generated.length}/${results.length}`);
  console.log(`  Fact-check pass: ${pass}/${generated.length}`);
  console.log(`  Banned hedge phrases found: ${totalHedge}`);
  console.log(`  Marketing closer phrases found: ${totalCloser}`);
  console.log(`  Avg words: ${avgWords}`);

  // Per-tier delivery vs target
  const byTier = new Map<
    string,
    {
      count: number;
      totalWords: number;
      expectedLow: number;
      expectedHigh: number;
    }
  >();
  for (const r of generated) {
    const [lo, hi] = r.expectedRange.split("-").map((s) => parseInt(s));
    const t = byTier.get(r.richness) ?? {
      count: 0,
      totalWords: 0,
      expectedLow: lo,
      expectedHigh: hi,
    };
    t.count++;
    t.totalWords += r.actualWords;
    byTier.set(r.richness, t);
  }
  console.log(`\nPer-tier delivery:`);
  for (const [tier, t] of byTier) {
    const avg = Math.round(t.totalWords / t.count);
    const inRange = avg >= t.expectedLow && avg <= t.expectedHigh;
    console.log(
      `  ${tier.padEnd(10)} n=${t.count}  avg=${avg}  target=${t.expectedLow}-${t.expectedHigh}  ${inRange ? "✓ in range" : avg < t.expectedLow ? "↓ below floor" : "↑ above ceiling"}`,
    );
  }

  // 6. Detailed violations per article
  const withViolations = generated.filter(
    (r) =>
      r.bannedHedges.length > 0 ||
      r.bannedClosers.length > 0 ||
      r.marketingCloser,
  );
  if (withViolations.length > 0) {
    console.log(`\nAnti-filler violations detail:`);
    for (const r of withViolations) {
      console.log(`\n  Article ${r.idx}: ${r.title.slice(0, 60)}`);
      for (const h of r.bannedHedges) {
        console.log(`    HEDGE "${h.phrase}"  ${h.snippet}`);
      }
      for (const c of r.bannedClosers) {
        console.log(`    CLOSER "${c.phrase}"  ${c.snippet}`);
      }
      if (r.marketingCloser) {
        console.log(
          `    MARKETING-CLOSER  "${r.marketingCloser.slice(0, 120)}…"`,
        );
      }
    }
  }

  // Exit status — matches the production pipeline contract
  const anyFactFail = generated.some((r) => !r.factCheckPass);
  if (anyFactFail) {
    console.log(`\n⚠  At least one article failed fact-check`);
    process.exit(1);
  }
  console.log(`\n✓ All generated articles passed fact-check`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[validate] fatal:", e);
  process.exit(1);
});
