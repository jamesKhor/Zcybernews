#!/usr/bin/env tsx
/**
 * Discoverability audit — verifies that "published" content is actually
 * eligible for crawl discovery: public tier, not draft/scheduled, canonical
 * URL shape, and current publication-gate reasons.
 *
 * This is intentionally local and deterministic. Google can still choose not
 * to index a page, but this script catches our side of the contract before a
 * pipeline run is treated as successful.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { articleUrl, type ArticleSection } from "../lib/article-url.js";
import {
  evaluatePublicGate,
  getPublishTier,
  isPublicFrontmatter,
} from "../lib/publication.js";
import {
  ArticleFrontmatterSchema,
  type ArticleFrontmatter,
} from "../lib/types.js";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const LOCALES = ["en", "zh"] as const;
const SECTIONS = ["posts", "threat-intel"] as const;

type Locale = (typeof LOCALES)[number];
type Section = (typeof SECTIONS)[number];
type Window = "24h" | "7d" | "30d" | "all";
type Format = "markdown" | "json";

interface Options {
  since: Window;
  format: Format;
  strict: boolean;
  jsonPath: string;
}

interface AuditArticle {
  filePath: string;
  locale: Locale;
  section: Section;
  slug: string;
  url: string;
  date: string;
  title: string;
  currentTier: ReturnType<typeof getPublishTier>;
  gateTier: ReturnType<typeof evaluatePublicGate>["tier"];
  indexable: boolean;
  draft: boolean;
  scheduledFuture: boolean;
  critical: boolean;
  staleTier: boolean;
  reasons: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    since: "7d",
    format: "markdown",
    strict: false,
    jsonPath: path.join(process.cwd(), "data", "discoverability-audit.json"),
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--strict") options.strict = true;
    else if (arg === "--all") options.since = "all";
    else if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length);
      if (
        value === "24h" ||
        value === "7d" ||
        value === "30d" ||
        value === "all"
      ) {
        options.since = value;
      }
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value === "markdown" || value === "json") options.format = value;
    } else if (arg.startsWith("--json=")) {
      options.jsonPath = arg.slice("--json=".length);
    }
  }

  return options;
}

function cutoffMs(since: Window): number {
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

function dateMs(value: string): number {
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59Z`
    : value;
  const parsed = new Date(effective).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFutureScheduled(frontmatter: ArticleFrontmatter): boolean {
  if (!frontmatter.scheduled_publish) return false;
  const scheduled = new Date(frontmatter.scheduled_publish).getTime();
  return Number.isFinite(scheduled) && scheduled > Date.now();
}

function isCritical(frontmatter: ArticleFrontmatter): boolean {
  return (
    frontmatter.severity === "critical" ||
    (frontmatter.cvss_score ?? 0) >= 9 ||
    /\bcritical\b/i.test(
      `${frontmatter.title} ${frontmatter.excerpt} ${frontmatter.tags.join(" ")}`,
    )
  );
}

function walkFiles(): string[] {
  const out: string[] = [];
  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      const dir = path.join(CONTENT_ROOT, locale, section);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".mdx") || file.endsWith(".md")) {
          out.push(path.join(dir, file));
        }
      }
    }
  }
  return out;
}

function loadArticle(filePath: string): AuditArticle | null {
  const relative = path.relative(CONTENT_ROOT, filePath);
  const [rawLocale, rawSection] = relative.split(path.sep);
  if (
    !LOCALES.includes(rawLocale as Locale) ||
    !SECTIONS.includes(rawSection as Section)
  ) {
    return null;
  }

  const parsed = matter(fs.readFileSync(filePath, "utf-8"));
  const result = ArticleFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    console.warn(
      `[discoverability] skip ${relative}: invalid frontmatter (${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")})`,
    );
    return null;
  }

  const frontmatter = result.data;
  const locale = rawLocale as Locale;
  const section = rawSection as Section;
  const currentTier = getPublishTier(frontmatter);
  const gate = evaluatePublicGate(frontmatter);
  const scheduledFuture = isFutureScheduled(frontmatter);
  const indexable =
    !frontmatter.draft && !scheduledFuture && isPublicFrontmatter(frontmatter);

  return {
    filePath,
    locale,
    section,
    slug: frontmatter.slug,
    url: articleUrl(frontmatter, locale, section as ArticleSection),
    date: frontmatter.date,
    title: frontmatter.title,
    currentTier,
    gateTier: gate.tier,
    indexable,
    draft: frontmatter.draft,
    scheduledFuture,
    critical: isCritical(frontmatter),
    staleTier: currentTier !== gate.tier,
    reasons: gate.reasons,
  };
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce(
    (acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }),
    {} as Record<T, number>,
  );
}

function renderMarkdown(articles: AuditArticle[], since: Window): string {
  const indexable = articles.filter((a) => a.indexable);
  const stale = articles.filter((a) => a.staleTier);
  const criticalBlocked = articles.filter((a) => a.critical && !a.indexable);
  const gatePublicStoredBrief = articles.filter(
    (a) => a.gateTier === "public" && a.currentTier === "brief",
  );
  const reasonCounts = countBy(articles.flatMap((a) => a.reasons));

  const lines: string[] = [];
  lines.push("# ZCyberNews Discoverability Audit");
  lines.push("");
  lines.push(`**Window:** ${since}`);
  lines.push(`**Scanned:** ${articles.length}`);
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Indexable now | ${indexable.length} |`);
  lines.push(
    `| Noindex / undiscoverable now | ${articles.length - indexable.length} |`,
  );
  lines.push(
    `| Gate says public but stored brief | ${gatePublicStoredBrief.length} |`,
  );
  lines.push(`| Critical but not indexable | ${criticalBlocked.length} |`);
  lines.push(`| Stored tier differs from current gate | ${stale.length} |`);
  lines.push("");
  lines.push("## Current Tiers");
  lines.push("");
  for (const [tier, count] of Object.entries(
    countBy(articles.map((a) => a.currentTier)),
  ).sort()) {
    lines.push(`- \`${tier}\`: ${count}`);
  }
  lines.push("");
  lines.push("## Top Gate Reasons");
  lines.push("");
  const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  if (topReasons.length === 0) {
    lines.push("- none");
  } else {
    for (const [reason, count] of topReasons.slice(0, 10)) {
      lines.push(`- \`${reason}\`: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Public Candidates Still Stored Brief");
  lines.push("");
  for (const article of gatePublicStoredBrief.slice(0, 20)) {
    lines.push(`- ${article.date} ${article.url} — ${article.title}`);
  }
  if (gatePublicStoredBrief.length > 20) {
    lines.push(`- ...and ${gatePublicStoredBrief.length - 20} more`);
  }
  lines.push("");
  lines.push("## Critical But Not Indexable");
  lines.push("");
  if (criticalBlocked.length === 0) {
    lines.push("- none");
  } else {
    for (const article of criticalBlocked.slice(0, 20)) {
      const reason =
        article.reasons.length > 0 ? article.reasons.join(", ") : "stored tier";
      lines.push(`- ${article.date} ${article.url} — ${reason}`);
    }
  }
  lines.push("");
  lines.push(
    `_Generated ${new Date().toISOString()} by \`scripts/audit-discoverability.ts\`._`,
  );
  return lines.join("\n");
}

function main(): number {
  const options = parseArgs(process.argv);
  const cutoff = cutoffMs(options.since);
  const articles = walkFiles()
    .map(loadArticle)
    .filter((article): article is AuditArticle => Boolean(article))
    .filter((article) => dateMs(article.date) >= cutoff)
    .sort((a, b) => dateMs(b.date) - dateMs(a.date));

  const payload = {
    generatedAt: new Date().toISOString(),
    window: options.since,
    summary: {
      total: articles.length,
      indexable: articles.filter((a) => a.indexable).length,
      gatePublicStoredBrief: articles.filter(
        (a) => a.gateTier === "public" && a.currentTier === "brief",
      ).length,
      criticalBlocked: articles.filter((a) => a.critical && !a.indexable)
        .length,
      staleTier: articles.filter((a) => a.staleTier).length,
    },
    articles,
  };

  fs.mkdirSync(path.dirname(options.jsonPath), { recursive: true });
  fs.writeFileSync(options.jsonPath, JSON.stringify(payload, null, 2) + "\n");

  if (options.format === "json") {
    console.log(JSON.stringify(payload.summary, null, 2));
  } else {
    console.log(renderMarkdown(articles, options.since));
  }

  return options.strict &&
    (payload.summary.gatePublicStoredBrief > 0 ||
      payload.summary.criticalBlocked > 0)
    ? 2
    : 0;
}

process.exit(main());
