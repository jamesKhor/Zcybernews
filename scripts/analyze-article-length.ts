/**
 * Analyze article-body length across the full corpus.
 *
 * Reports:
 *   - char count distribution (min, p25, median, p75, p90, max, avg)
 *   - word count distribution (space-split)
 *   - separate runs for EN and ZH (CJK chars vs words differ)
 *   - buckets: <500, 500-1000, 1000-2000, 2000-4000, 4000+
 *
 * Run: npx tsx scripts/analyze-article-length.ts
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

type Stats = {
  label: string;
  count: number;
  minChars: number;
  maxChars: number;
  avgChars: number;
  medianChars: number;
  p25Chars: number;
  p75Chars: number;
  p90Chars: number;
  minWords: number;
  maxWords: number;
  avgWords: number;
  medianWords: number;
  buckets: Record<string, number>;
};

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function computeStats(dir: string, label: string, isZh: boolean): Stats | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"));
  if (files.length === 0) return null;

  const charCounts: number[] = [];
  const wordCounts: number[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf-8");
    const { content } = matter(raw);
    const chars = content.length;
    // For ZH: count CJK chars as words (approximate — each CJK char ~= a
    // word for read-time purposes). For EN: whitespace-split.
    const words = isZh
      ? (content.match(/[\u4e00-\u9fff]/g) || []).length
      : content.split(/\s+/).filter(Boolean).length;
    charCounts.push(chars);
    wordCounts.push(words);
  }

  const buckets = {
    "<500": 0,
    "500-1000": 0,
    "1000-2000": 0,
    "2000-4000": 0,
    "4000+": 0,
  };
  for (const w of wordCounts) {
    if (w < 500) buckets["<500"]++;
    else if (w < 1000) buckets["500-1000"]++;
    else if (w < 2000) buckets["1000-2000"]++;
    else if (w < 4000) buckets["2000-4000"]++;
    else buckets["4000+"]++;
  }

  return {
    label,
    count: files.length,
    minChars: Math.min(...charCounts),
    maxChars: Math.max(...charCounts),
    avgChars: Math.round(
      charCounts.reduce((a, b) => a + b, 0) / charCounts.length,
    ),
    medianChars: pct(charCounts, 0.5),
    p25Chars: pct(charCounts, 0.25),
    p75Chars: pct(charCounts, 0.75),
    p90Chars: pct(charCounts, 0.9),
    minWords: Math.min(...wordCounts),
    maxWords: Math.max(...wordCounts),
    avgWords: Math.round(
      wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
    ),
    medianWords: pct(wordCounts, 0.5),
    buckets,
  };
}

function printStats(s: Stats) {
  console.log(`\n▰▰▰ ${s.label} — ${s.count} articles ▰▰▰`);
  console.log(
    `  CHARS  min=${s.minChars}  p25=${s.p25Chars}  median=${s.medianChars}  p75=${s.p75Chars}  p90=${s.p90Chars}  max=${s.maxChars}  avg=${s.avgChars}`,
  );
  console.log(
    `  WORDS  min=${s.minWords}  median=${s.medianWords}  max=${s.maxWords}  avg=${s.avgWords}`,
  );
  console.log(`  BUCKETS (by word count):`);
  for (const [bucket, count] of Object.entries(s.buckets)) {
    const pctStr = ((count / s.count) * 100).toFixed(0);
    console.log(
      `    ${bucket.padEnd(10)}  ${String(count).padStart(4)}  (${pctStr}%)`,
    );
  }
}

function main() {
  const targets = [
    { dir: "content/en/posts", label: "EN posts", isZh: false },
    { dir: "content/en/threat-intel", label: "EN threat-intel", isZh: false },
    { dir: "content/zh/posts", label: "ZH posts", isZh: true },
    { dir: "content/zh/threat-intel", label: "ZH threat-intel", isZh: true },
  ];
  for (const t of targets) {
    const s = computeStats(t.dir, t.label, t.isZh);
    if (s) printStats(s);
  }

  // Cross-corpus quick view: what's currently getting cut off?
  console.log(`\n▰▰▰ EN body length as % of 1200-word prompt target ▰▰▰`);
  const enPosts = computeStats("content/en/posts", "EN posts", false);
  if (enPosts) {
    const targetWords = 1200;
    console.log(`  Prompt target: ${targetWords} words`);
    console.log(
      `  Actual median: ${enPosts.medianWords}  (${((enPosts.medianWords / targetWords) * 100).toFixed(0)}% of target)`,
    );
    console.log(
      `  Actual avg:    ${enPosts.avgWords}  (${((enPosts.avgWords / targetWords) * 100).toFixed(0)}% of target)`,
    );
    console.log(
      `  Actual max:    ${enPosts.maxWords}  (${((enPosts.maxWords / targetWords) * 100).toFixed(0)}% of target)`,
    );
  }
}

main();
