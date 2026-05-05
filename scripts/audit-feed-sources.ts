#!/usr/bin/env tsx
import fs from "node:fs";
import { FEED_SOURCES, type FeedSource } from "./sources/feeds.js";
import { fetchSourceStories } from "./pipeline/ingest-rss.js";
import { isThinExcerpt } from "./pipeline/filters/thin-excerpt.js";
import type { Story } from "./utils/dedup.js";

type AuditStatus = "ok" | "warn" | "fail" | "disabled";

interface SourceAuditResult {
  id: string;
  name: string;
  type: string;
  url: string;
  enabled: boolean;
  status: AuditStatus;
  issues: string[];
  itemCount: number;
  thinCount: number;
  blankExcerptCount: number;
  emptyThinCount: number;
  boilerplateThinCount: number;
  belowThresholdThinCount: number;
  newestAgeDays: number | null;
  firstTitle: string | null;
  elapsedMs: number;
  error?: string;
}

const args = process.argv.slice(2);
const INCLUDE_DISABLED = args.includes("--all");
const JSON_OUTPUT = args.includes("--json");
const STRICT = args.includes("--strict");
const WRITE = args.includes("--write");

function newestAgeDays(stories: Story[]): number | null {
  const newest = stories
    .map((story) => Date.parse(story.publishedAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!newest) return null;
  return Math.max(0, Math.round((Date.now() - newest) / 86_400_000));
}

export function analyzeSourceStories(
  source: FeedSource,
  stories: Story[],
  elapsedMs: number,
): SourceAuditResult {
  const verdicts = stories.map((story) =>
    isThinExcerpt({ title: story.title, excerpt: story.excerpt }),
  );
  const thinCount = verdicts.filter((verdict) => verdict.isThin).length;
  const emptyThinCount = verdicts.filter(
    (verdict) => verdict.reason === "empty",
  ).length;
  const boilerplateThinCount = verdicts.filter(
    (verdict) => verdict.reason === "boilerplate-only",
  ).length;
  const belowThresholdThinCount = verdicts.filter(
    (verdict) => verdict.reason === "below-threshold",
  ).length;
  const blankExcerptCount = stories.filter(
    (story) => !story.excerpt?.trim(),
  ).length;
  const ageDays = newestAgeDays(stories);
  const issues: string[] = [];

  if (stories.length === 0) issues.push("no_items");
  if (
    (emptyThinCount + boilerplateThinCount) / Math.max(stories.length, 1) >
    0.5
  ) {
    issues.push("empty_or_boilerplate_excerpt_majority");
  }
  if (belowThresholdThinCount / Math.max(stories.length, 1) > 0.5) {
    issues.push("below_threshold_excerpt_majority");
  }
  if (blankExcerptCount / Math.max(stories.length, 1) > 0.5) {
    issues.push("blank_excerpt_majority");
  }
  if (ageDays !== null && ageDays > 60) {
    issues.push(`stale_newest_${ageDays}d`);
  }

  const hardIssue = issues.some(
    (issue) =>
      issue === "no_items" ||
      issue === "empty_or_boilerplate_excerpt_majority" ||
      issue === "blank_excerpt_majority",
  );

  return {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    enabled: source.enabled,
    status: hardIssue ? "fail" : issues.length > 0 ? "warn" : "ok",
    issues,
    itemCount: stories.length,
    thinCount,
    blankExcerptCount,
    emptyThinCount,
    boilerplateThinCount,
    belowThresholdThinCount,
    newestAgeDays: ageDays,
    firstTitle: stories[0]?.title ?? null,
    elapsedMs,
  };
}

function disabledResult(source: FeedSource): SourceAuditResult {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    enabled: false,
    status: "disabled",
    issues: [],
    itemCount: 0,
    thinCount: 0,
    blankExcerptCount: 0,
    emptyThinCount: 0,
    boilerplateThinCount: 0,
    belowThresholdThinCount: 0,
    newestAgeDays: null,
    firstTitle: null,
    elapsedMs: 0,
  };
}

async function auditSource(source: FeedSource): Promise<SourceAuditResult> {
  if (!source.enabled) return disabledResult(source);
  const started = Date.now();
  try {
    const stories = await fetchSourceStories(source);
    return analyzeSourceStories(source, stories, Date.now() - started);
  } catch (err) {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      enabled: source.enabled,
      status: "fail",
      issues: ["fetch_failed"],
      itemCount: 0,
      thinCount: 0,
      blankExcerptCount: 0,
      emptyThinCount: 0,
      boilerplateThinCount: 0,
      belowThresholdThinCount: 0,
      newestAgeDays: null,
      firstTitle: null,
      elapsedMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderMarkdown(results: SourceAuditResult[]): string {
  const lines: string[] = [];
  lines.push("# Feed Source Audit");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Status | Source | Items | Thin | Blank | Newest | Issues |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const result of results) {
    const newest =
      result.newestAgeDays === null ? "n/a" : `${result.newestAgeDays}d`;
    const issueText =
      result.issues.length > 0 ? result.issues.join(", ") : "none";
    lines.push(
      `| ${result.status} | ${result.id} | ${result.itemCount} | ${result.thinCount} | ${result.blankExcerptCount} | ${newest} | ${issueText} |`,
    );
  }
  lines.push("");
  const failing = results.filter((result) => result.status === "fail");
  if (failing.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const result of failing) {
      lines.push(
        `- ${result.id}: ${result.issues.join(", ")}${result.error ? ` (${result.error})` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const sources = INCLUDE_DISABLED
    ? FEED_SOURCES
    : FEED_SOURCES.filter((source) => source.enabled);
  const results: SourceAuditResult[] = [];
  for (const source of sources) {
    results.push(await auditSource(source));
  }

  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderMarkdown(results)}\n`);
  }

  if (WRITE) {
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(
      "data/feed-source-audit.json",
      `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
    );
  }

  if (STRICT && results.some((result) => result.status === "fail")) {
    process.exit(2);
  }
}

if (
  process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/audit-feed-sources.ts")
) {
  main().catch((err) => {
    console.error("[feed-source-audit] failed:", err);
    process.exit(1);
  });
}
