#!/usr/bin/env node
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { ArticleFrontmatterSchema } from "../lib/types.js";
import {
  evaluatePublicGate,
  type PublicGateResult,
} from "../lib/publication.js";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const LOCALES = ["en", "zh"] as const;
const SECTIONS = ["posts", "threat-intel"] as const;

interface Entry {
  filePath: string;
  locale: (typeof LOCALES)[number];
  section: (typeof SECTIONS)[number];
  raw: string;
  body: string;
  data: Record<string, unknown>;
  frontmatter: ReturnType<typeof ArticleFrontmatterSchema.parse>;
}

interface PlannedUpdate {
  entry: Entry;
  tier: PublicGateResult["tier"];
  reasons: string[];
  sourceCount: number;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SINCE = args.find((arg) => arg.startsWith("--since="))?.split("=")[1];

function parseSince(value: string | undefined): number | null {
  if (!value) return null;
  const dayMatch = /^(\d+)d$/.exec(value);
  if (dayMatch) {
    return Date.now() - Number(dayMatch[1]) * 24 * 60 * 60 * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function withinSince(date: string, cutoff: number | null): boolean {
  if (!cutoff) return true;
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date}T23:59:59Z`
    : date;
  const time = new Date(effective).getTime();
  return Number.isFinite(time) && time >= cutoff;
}

function walkContent(): string[] {
  const files: string[] = [];
  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      const dir = path.join(CONTENT_ROOT, locale, section);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".mdx") || file.endsWith(".md")) {
          files.push(path.join(dir, file));
        }
      }
    }
  }
  return files;
}

function loadEntry(filePath: string): Entry | null {
  const relative = path.relative(CONTENT_ROOT, filePath);
  const [locale, section] = relative.split(path.sep);
  if (
    !LOCALES.includes(locale as never) ||
    !SECTIONS.includes(section as never)
  ) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const result = ArticleFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    console.warn(
      `[skip] ${relative}: invalid frontmatter (${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")})`,
    );
    return null;
  }

  return {
    filePath,
    locale: locale as Entry["locale"],
    section: section as Entry["section"],
    raw,
    body: parsed.content,
    data: parsed.data,
    frontmatter: result.data,
  };
}

function groupKey(entry: Entry): string {
  return entry.frontmatter.locale_pair ?? entry.frontmatter.slug;
}

function canonicalDecision(entries: Entry[]): PublicGateResult {
  const en = entries.find((entry) => entry.locale === "en");
  return evaluatePublicGate((en ?? entries[0]).frontmatter);
}

function planUpdate(entry: Entry, decision: PublicGateResult): PlannedUpdate {
  return {
    entry,
    tier: decision.tier,
    reasons: decision.reasons,
    sourceCount:
      entry.frontmatter.source_count ?? entry.frontmatter.source_urls.length,
  };
}

function applyUpdate(update: PlannedUpdate): boolean {
  const { entry, tier, reasons, sourceCount } = update;
  const nextData = { ...entry.data };
  let changed = false;

  if (nextData.publish_tier !== tier) {
    nextData.publish_tier = tier;
    changed = true;
  }

  const existingReasons = Array.isArray(nextData.public_gate_reasons)
    ? nextData.public_gate_reasons
    : [];
  if (JSON.stringify(existingReasons) !== JSON.stringify(reasons)) {
    if (reasons.length > 0) nextData.public_gate_reasons = reasons;
    else delete nextData.public_gate_reasons;
    changed = true;
  }

  if (sourceCount > 0 && nextData.source_count !== sourceCount) {
    nextData.source_count = sourceCount;
    changed = true;
  }

  if (!changed) return false;
  if (APPLY) {
    fs.writeFileSync(
      entry.filePath,
      matter.stringify(entry.body, nextData),
      "utf-8",
    );
  }
  return true;
}

function main() {
  const cutoff = parseSince(SINCE);
  const entries = walkContent()
    .map(loadEntry)
    .filter((entry): entry is Entry => Boolean(entry))
    .filter((entry) => withinSince(entry.frontmatter.date, cutoff));

  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const tierCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  let changedFiles = 0;

  for (const group of groups.values()) {
    const decision = canonicalDecision(group);
    for (const entry of group) {
      const update = planUpdate(entry, decision);
      tierCounts.set(update.tier, (tierCounts.get(update.tier) ?? 0) + 1);
      for (const reason of update.reasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      if (applyUpdate(update)) changedFiles++;
    }
  }

  console.log(
    `[publish-tier] ${APPLY ? "Applied" : "Dry run"} ${entries.length} file(s)${
      SINCE ? ` since ${SINCE}` : ""
    }`,
  );
  console.log(`[publish-tier] ${changedFiles} file(s) would change`);
  console.log("[publish-tier] Tier counts:");
  for (const [tier, count] of [...tierCounts.entries()].sort()) {
    console.log(`  ${tier}: ${count}`);
  }
  if (reasonCounts.size > 0) {
    console.log("[publish-tier] Top gate reasons:");
    for (const [reason, count] of [...reasonCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${reason}: ${count}`);
    }
  }
}

main();
