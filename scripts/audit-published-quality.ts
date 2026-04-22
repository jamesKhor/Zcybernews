#!/usr/bin/env tsx
/**
 * Daily quality audit — scans published MDX and scores each article
 * against the v1 quality model (scripts/pipeline/quality-scorer.ts).
 *
 * Why this exists (2026-04-22): Plausible shows ~14 real humans / day
 * reading the site, mostly from Bing + LinkedIn + professional shares.
 * Every thin or hedging article we publish costs us trust with that
 * small audience. This script surfaces those articles so we can triage
 * daily before the next publish cycle.
 *
 * Usage:
 *   npm run quality:audit              # last 24h, writes JSON + markdown
 *   tsx scripts/audit-published-quality.ts --since=7d
 *   tsx scripts/audit-published-quality.ts --all
 *   tsx scripts/audit-published-quality.ts --format=json
 *
 * Outputs:
 *   data/quality-daily.json            # machine-readable summary
 *   stdout                             # human-readable markdown table
 *
 * Exit codes:
 *   0 — no SERIOUS flags
 *   2 — at least one SERIOUS flag (suitable for CI gating)
 *   1 — script error (unexpected)
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { scoreArticle, summarize } from "./pipeline/quality-scorer.js";
import type {
  QualityScore,
  QualitySummary,
} from "./pipeline/quality-scorer.js";
import {
  ArticleFrontmatterSchema,
  type ArticleFrontmatter,
} from "../lib/types.js";

interface Options {
  since: "24h" | "7d" | "30d" | "all";
  format: "markdown" | "json";
  jsonPath: string;
  contentRoot: string;
}

function parseArgs(argv: string[]): Options {
  const args = argv.slice(2);
  const options: Options = {
    since: "24h",
    format: "markdown",
    jsonPath: path.join(process.cwd(), "data", "quality-daily.json"),
    contentRoot: path.join(process.cwd(), "content"),
  };
  for (const a of args) {
    if (a === "--all") options.since = "all";
    else if (a.startsWith("--since=")) {
      const v = a.slice("--since=".length);
      if (v === "24h" || v === "7d" || v === "30d" || v === "all") {
        options.since = v;
      }
    } else if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      if (v === "json" || v === "markdown") options.format = v;
    } else if (a.startsWith("--json=")) {
      options.jsonPath = a.slice("--json=".length);
    }
  }
  return options;
}

function sinceCutoffMs(since: Options["since"]): number {
  const now = Date.now();
  switch (since) {
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return 0;
  }
}

interface LoadedArticle {
  slug: string;
  locale: string;
  section: "posts" | "threat-intel";
  filePath: string;
  mtimeMs: number;
  raw: string;
}

/** Walk content/<locale>/<section>/*.mdx and yield all articles. */
function walkArticles(contentRoot: string): LoadedArticle[] {
  const locales = ["en", "zh"];
  const sections: Array<"posts" | "threat-intel"> = ["posts", "threat-intel"];
  const out: LoadedArticle[] = [];
  for (const locale of locales) {
    for (const section of sections) {
      const dir = path.join(contentRoot, locale, section);
      if (!fs.existsSync(dir)) continue;
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".mdx"))
        .map((f) => path.join(dir, f));
      for (const fp of files) {
        const stat = fs.statSync(fp);
        out.push({
          slug: path.basename(fp, ".mdx"),
          locale,
          section,
          filePath: fp,
          mtimeMs: stat.mtimeMs,
          raw: fs.readFileSync(fp, "utf-8"),
        });
      }
    }
  }
  return out;
}

/** Parse + validate frontmatter. Returns null on schema failure so the
 *  audit can continue rather than abort on one bad file. */
function parseArticle(
  loaded: LoadedArticle,
): ReturnType<typeof scoreArticle> | null {
  try {
    const parsed = matter(loaded.raw);
    // Loose parse: validate, then fall through with the validated
    // object. If validation fails, use the raw data so we at least
    // score the article rather than skip it silently.
    const result = ArticleFrontmatterSchema.safeParse(parsed.data);
    // Loose mode: if the frontmatter doesn't pass strict Zod validation
    // (which happens for older articles missing newer required fields),
    // we still score against the raw data rather than skip. Casting via
    // `as ArticleFrontmatter` is intentional — scoreArticle reads only
    // a small, well-known set of fields and defensively handles missing
    // ones, so the looseness is contained.
    const fm: ArticleFrontmatter = result.success
      ? result.data
      : (parsed.data as ArticleFrontmatter);
    // The slug from disk filename is typically `{date}-{slug}`. Prefer
    // the frontmatter slug (what the URL uses) if present.
    const slug =
      (fm?.slug as string | undefined) ??
      loaded.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    return scoreArticle({
      slug,
      locale: loaded.locale,
      section: loaded.section,
      frontmatter: fm,
      body: parsed.content,
    });
  } catch (err) {
    console.warn(
      `[quality-audit] skipping ${loaded.filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Output rendering ────────────────────────────────────────────────

function renderMarkdown(
  scores: QualityScore[],
  summary: QualitySummary,
  since: string,
): string {
  const L: string[] = [];
  L.push(`# ZCyberNews — Daily Quality Audit`);
  L.push("");
  L.push(`**Window:** ${since}`);
  L.push(`**Scanned:** ${summary.total} articles`);
  L.push("");
  L.push(`## Summary`);
  L.push("");
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Articles scored | ${summary.total} |`);
  L.push(`| 🔴 SERIOUS | ${summary.seriousCount} |`);
  L.push(`| 🟡 WARN | ${summary.warnCount} |`);
  L.push(`| 🟢 OK | ${summary.okCount} |`);
  L.push(`| Avg headline score | ${summary.avgHeadlineScore} / 10 |`);
  L.push(`| Avg word count | ${summary.avgWordCount} |`);
  L.push(`| Avg structured richness | ${summary.avgStructuredRichness} / 5 |`);
  L.push("");
  L.push(`## Top flags`);
  L.push("");
  if (summary.topFlagCodes.length === 0) {
    L.push("_(no flags)_");
  } else {
    L.push(`| Code | Count |`);
    L.push(`|---|---|`);
    for (const f of summary.topFlagCodes) {
      L.push(`| \`${f.code}\` | ${f.count} |`);
    }
  }
  L.push("");
  L.push(`## By category`);
  L.push("");
  L.push(`| Category | Count | Avg score | SERIOUS |`);
  L.push(`|---|---|---|---|`);
  for (const [cat, v] of Object.entries(summary.byCategory)) {
    L.push(`| ${cat} | ${v.count} | ${v.avgScore} | ${v.serious} |`);
  }
  L.push("");

  // Lowest-scoring articles first — this is the triage list
  const ranked = scores
    .slice()
    .sort((a, b) => a.headlineScore - b.headlineScore);
  const worst = ranked.slice(0, 15);
  L.push(`## Worst ${worst.length} articles (triage these first)`);
  L.push("");
  if (worst.length === 0) {
    L.push("_(none)_");
  } else {
    L.push(`| Score | Locale | Section | Slug | Words | Struct | Flags |`);
    L.push(`|---|---|---|---|---|---|---|`);
    for (const s of worst) {
      const flagCodes = s.flags.map((f) => f.code).join(", ");
      const severity = s.flags.some((f) => f.severity === "serious")
        ? "🔴"
        : s.flags.some((f) => f.severity === "warn")
          ? "🟡"
          : "🟢";
      L.push(
        `| ${severity} ${s.headlineScore} | ${s.locale} | ${s.section} | \`${s.slug}\` | ${s.wordCount}/${s.wordCountFloor} | ${s.structuredRichness}/5 | ${flagCodes || "—"} |`,
      );
    }
  }
  L.push("");
  L.push(
    `_Generated ${new Date().toISOString()} by \`scripts/audit-published-quality.ts\`._`,
  );
  return L.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────

function main(): number {
  const options = parseArgs(process.argv);
  const cutoff = sinceCutoffMs(options.since);

  if (!fs.existsSync(options.contentRoot)) {
    console.error(
      `[quality-audit] content root not found: ${options.contentRoot}`,
    );
    return 1;
  }

  const loaded = walkArticles(options.contentRoot).filter(
    (a) => a.mtimeMs >= cutoff,
  );
  const scores: QualityScore[] = [];
  for (const a of loaded) {
    const s = parseArticle(a);
    if (s) scores.push(s);
  }
  const summary = summarize(scores);

  // Always persist JSON for downstream tooling (Discord digest,
  // long-term quality trend graphs, etc).
  try {
    const dir = path.dirname(options.jsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      options.jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          window: options.since,
          summary,
          articles: scores,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (err) {
    console.warn(
      `[quality-audit] failed to write JSON:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (options.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(renderMarkdown(scores, summary, options.since));
  }

  // Exit 2 if any SERIOUS flag so CI / wrappers can detect.
  return summary.seriousCount > 0 ? 2 : 0;
}

process.exit(main());
