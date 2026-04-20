/**
 * P2 — Aggregate structured facts per tag from MDX frontmatter.
 *
 * Pure script. Zero LLM. Zero network. Reads `content/{locale}/{posts,threat-intel}`
 * through `lib/content.ts` (memoized) and writes `data/tag-facts/{locale}/{tag}.json`.
 *
 * Idempotent + deterministic: sorted arrays, stable sources_hash, safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/tag-intros/aggregate-facts.ts            # all locales
 *   npx tsx scripts/tag-intros/aggregate-facts.ts --limit 3  # first 3 tags per locale
 *   npx tsx scripts/tag-intros/aggregate-facts.ts --locale en
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getAllPosts } from "../../lib/content.js";
import type { Article, ArticleFrontmatter } from "../../lib/types.js";
import { MIN_TAG_COUNT, type TagCve, type TagFactSheet } from "./types.js";

const LOCALES = ["en", "zh"] as const;
type Locale = (typeof LOCALES)[number];

// ─── CLI args ────────────────────────────────────────────────────────────────
interface Args {
  limit?: number;
  locale?: Locale;
}
function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = parseInt(argv[++i], 10);
    else if (a === "--locale") out.locale = argv[++i] as Locale;
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Descriptor filters — remove non-name-like strings from "top_X" lists so the
// LLM never sees "Russian-speaking threat actor" next to "Lazarus Group" and
// conflates them via apposition. See scripts/audit-tag-facts.ts for the full
// bug enumeration that drove these patterns (2026-04-20).
const ACTOR_DESCRIPTOR_RX =
  /^(unknown|unnamed|undisclosed|anonymous|russian-speaking|chinese-speaking|north korean|iranian|state-sponsored|state sponsored|nation-state|nation state|apt group|threat actor|threat group|cybercrime group|ransomware gang|affiliate|affiliates)s?(\s|$)|\b(threat actor|threat group|actors?|operatives?)$/i;
const SECTOR_DESCRIPTOR_RX = /^(any |all |various |multiple )/i;

function isDescriptorActor(s: string): boolean {
  return ACTOR_DESCRIPTOR_RX.test(s.trim());
}
function isDescriptorSector(s: string): boolean {
  return SECTOR_DESCRIPTOR_RX.test(s.trim());
}

/** Normalize region casing — treat "Global" and "global" as the same bucket. */
function normalizeRegion(s: string): string {
  const t = s.trim();
  if (!t) return t;
  // Title-case "global" → "Global" etc.; preserve all-caps acronyms (EU, US, UK).
  if (/^[A-Z]{2,4}$/.test(t)) return t;
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Top-N items by frequency across an array of string arrays, stable order.
 * Optional `filter` predicate drops descriptor-like strings; optional
 * `normalize` lets callers case-fold entries before counting so "Global"
 * and "global" merge into one bucket.
 */
function topByFrequency(
  values: string[][],
  n: number,
  opts: {
    filter?: (s: string) => boolean;
    normalize?: (s: string) => string;
  } = {},
): string[] {
  const counts = new Map<string, number>();
  for (const list of values) {
    for (const raw of list) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (opts.filter && opts.filter(trimmed)) continue;
      const key = opts.normalize ? opts.normalize(trimmed) : trimmed;
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

/** Top-N CVEs by CVSS (desc), tiebreak by ID asc for determinism. */
function topCvesByCvss(articles: Article[], n: number): TagCve[] {
  const map = new Map<string, number | undefined>();
  for (const a of articles) {
    const ids = a.frontmatter.cve_ids ?? [];
    for (const id of ids) {
      const key = id.trim().toUpperCase();
      if (!key) continue;
      const existing = map.get(key);
      const cvss = a.frontmatter.cvss_score;
      if (
        existing === undefined ||
        (cvss !== undefined &&
          (existing === undefined || cvss > (existing ?? -1)))
      ) {
        map.set(key, cvss);
      }
    }
  }
  return Array.from(map.entries())
    .map(([id, cvss]) => ({ id, cvss }))
    .sort((a, b) => (b.cvss ?? -1) - (a.cvss ?? -1) || a.id.localeCompare(b.id))
    .slice(0, n);
}

function buildSourcesHash(articles: Article[]): string {
  const sorted = articles.map((a) => a.frontmatter.slug).sort();
  const latest =
    articles
      .map((a) => a.frontmatter.updated ?? a.frontmatter.date)
      .sort()
      .pop() ?? "";
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ slugs: sorted, latest }))
    .digest("hex")
    .slice(0, 16);
}

function firstSentences(text: string, max = 200): string {
  const clean = text
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastPeriod = cut.lastIndexOf(". ");
  return (lastPeriod > 80 ? cut.slice(0, lastPeriod + 1) : cut).trim();
}

// ─── Core ────────────────────────────────────────────────────────────────────

function buildFactSheet(
  tag: string,
  locale: Locale,
  articles: Article[],
): TagFactSheet {
  const fms: ArticleFrontmatter[] = articles.map((a) => a.frontmatter);
  const dates = fms.map((f) => f.date).sort();
  const first = dates[0];
  const latest = dates[dates.length - 1];

  const topActors = topByFrequency(
    fms.map((f) => (f.threat_actor ? [f.threat_actor] : [])),
    3,
    { filter: isDescriptorActor },
  );
  const topSectors = topByFrequency(
    fms.map((f) => f.affected_sectors ?? []),
    5,
    { filter: isDescriptorSector },
  );
  const topRegions = topByFrequency(
    fms.map((f) => f.affected_regions ?? []),
    5,
    { normalize: normalizeRegion },
  );
  const topCves = topCvesByCvss(articles, 5);

  const severity_mix: Record<string, number> = {};
  for (const f of fms) {
    if (!f.severity) continue;
    severity_mix[f.severity] = (severity_mix[f.severity] ?? 0) + 1;
  }

  // 3 most-recent excerpts (by date desc — articles are already sorted desc by getAllPosts)
  const recent_excerpts = articles
    .slice(0, 3)
    .map((a) => firstSentences(a.frontmatter.excerpt || a.content, 200))
    .filter(Boolean);

  return {
    tag,
    locale,
    count: articles.length,
    date_range: { first, latest },
    top_actors: topActors,
    top_cves: topCves,
    top_sectors: topSectors,
    top_regions: topRegions,
    severity_mix,
    recent_excerpts,
    sources_hash: buildSourcesHash(articles),
  };
}

function sanitizeFilename(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function writeFactSheet(sheet: TagFactSheet): string {
  const dir = path.join(process.cwd(), "data", "tag-facts", sheet.locale);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sanitizeFilename(sheet.tag)}.json`);
  fs.writeFileSync(file, JSON.stringify(sheet, null, 2) + "\n", "utf-8");
  return file;
}

export function aggregateLocale(
  locale: Locale,
  limit?: number,
): TagFactSheet[] {
  // Combine posts + threat-intel under a single tag grouping — matches how
  // tag pages render (see app/[locale]/tags/[tag]/page.tsx which calls
  // getAllPosts for both types).
  const posts = getAllPosts(locale, "posts");
  const ti = getAllPosts(locale, "threat-intel");
  const all = [...posts, ...ti];

  const byTag = new Map<string, Article[]>();
  for (const a of all) {
    for (const tag of a.frontmatter.tags ?? []) {
      const key = tag.trim();
      if (!key) continue;
      const list = byTag.get(key) ?? [];
      list.push(a);
      byTag.set(key, list);
    }
  }

  const eligible = Array.from(byTag.entries())
    .filter(([, arts]) => arts.length >= MIN_TAG_COUNT)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const picked =
    typeof limit === "number" ? eligible.slice(0, limit) : eligible;

  const sheets: TagFactSheet[] = [];
  for (const [tag, articles] of picked) {
    const sheet = buildFactSheet(tag, locale, articles);
    writeFactSheet(sheet);
    sheets.push(sheet);
  }
  return sheets;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const locales: Locale[] = args.locale ? [args.locale] : [...LOCALES];
  let total = 0;
  for (const locale of locales) {
    const sheets = aggregateLocale(locale, args.limit);
    console.log(
      `[aggregate-facts] ${locale}: wrote ${sheets.length} fact sheets (min count ${MIN_TAG_COUNT})`,
    );
    total += sheets.length;
  }
  console.log(`[aggregate-facts] done — ${total} sheets total`);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("aggregate-facts.ts") ||
    process.argv[1].endsWith("aggregate-facts.js"));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
