/**
 * Backfill — fix the 12 articles surfaced by audit-frontmatter-seo.ts on
 * 2026-04-21. One-shot script, idempotent (re-running is safe — it only
 * fills missing fields, never overwrites existing values).
 *
 * Three classes of fix:
 *   1. Missing locale_pair → scan content/<other-locale>/ for matching slug
 *   2. Empty tags → derive from title using deriveTagsFromTitle pattern
 *   3. Missing source_urls → extract from "## References" section in body,
 *      else from inline [text](url) markdown links to known security domains
 *
 * Anything we can't auto-fix is reported. Operator decides whether to
 * hand-fix or accept the gap.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CONTENT_ROOT = path.join(process.cwd(), "content");

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "with",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "new",
  "via",
  "after",
  "before",
  "into",
]);
function deriveTagsFromTitle(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, 5);
}

function extractUrlsFromBody(body: string): string[] {
  const urls = new Set<string>();
  // Markdown links [text](url)
  for (const m of body.matchAll(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)) {
    urls.add(m[1]);
  }
  // Bare URLs in body (especially under ## References)
  for (const m of body.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    urls.add(m[0]);
  }
  return Array.from(urls).filter(
    (u) =>
      // Filter out our own domain + image hosts + common non-source patterns
      !u.includes("zcybernews.com") &&
      !u.includes("/images/") &&
      !u.endsWith(".png") &&
      !u.endsWith(".jpg") &&
      !u.endsWith(".webp") &&
      !u.endsWith(".svg"),
  );
}

interface FixReport {
  file: string;
  fixed: string[];
  skipped: string[];
}

function backfillFile(filepath: string): FixReport {
  const report: FixReport = { file: filepath, fixed: [], skipped: [] };
  const raw = fs.readFileSync(filepath, "utf-8");
  const parsed = matter(raw);
  const fm = parsed.data;
  let changed = false;

  // ── Fix 1: missing locale_pair ────────────────────────────────────────
  if (!fm.locale_pair) {
    const slug = fm.slug;
    const myLocale = fm.language as string | undefined;
    const otherLocale = myLocale === "en" ? "zh" : "en";
    if (myLocale && slug) {
      // Same slug, other locale — look in both posts/ and threat-intel/
      for (const type of ["posts", "threat-intel"]) {
        const candidate = path.join(
          CONTENT_ROOT,
          otherLocale,
          type,
          `${slug}.mdx`,
        );
        if (fs.existsSync(candidate)) {
          fm.locale_pair = slug;
          report.fixed.push(
            `locale_pair → ${slug} (${otherLocale}/${type} exists)`,
          );
          changed = true;
          break;
        }
      }
      if (!fm.locale_pair) {
        report.skipped.push(
          `locale_pair: no ${otherLocale} counterpart found for slug ${slug}`,
        );
      }
    }
  }

  // ── Fix 2: empty tags ─────────────────────────────────────────────────
  if (!Array.isArray(fm.tags) || fm.tags.length === 0) {
    if (typeof fm.title === "string") {
      const derived = deriveTagsFromTitle(fm.title);
      if (derived.length > 0) {
        fm.tags = derived;
        report.fixed.push(
          `tags → [${derived.join(", ")}] (derived from title)`,
        );
        changed = true;
      } else {
        report.skipped.push(`tags: title produced no derivable tags`);
      }
    }
  }

  // ── Fix 3: missing source_urls ────────────────────────────────────────
  if (!Array.isArray(fm.source_urls) || fm.source_urls.length === 0) {
    const urls = extractUrlsFromBody(parsed.content);
    if (urls.length > 0) {
      fm.source_urls = urls;
      report.fixed.push(
        `source_urls → ${urls.length} URL(s) extracted from body`,
      );
      changed = true;
    } else {
      report.skipped.push(`source_urls: no URLs found in body to derive from`);
    }
  }

  if (changed) {
    const out = matter.stringify(parsed.content, fm);
    fs.writeFileSync(filepath, out, "utf-8");
  }

  return report;
}

function walkContent(): string[] {
  const out: string[] = [];
  for (const locale of ["en", "zh"]) {
    for (const type of ["posts", "threat-intel"]) {
      const dir = path.join(CONTENT_ROOT, locale, type);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".mdx")) out.push(path.join(dir, f));
      }
    }
  }
  return out;
}

function main() {
  const files = walkContent();
  console.log(`Scanning ${files.length} MDX files for backfill candidates…\n`);
  let totalFixed = 0;
  let totalFiles = 0;
  const skippedSummary = new Map<string, number>();

  for (const f of files) {
    const r = backfillFile(f);
    if (r.fixed.length > 0) {
      totalFiles++;
      totalFixed += r.fixed.length;
      console.log(`✓ ${path.relative(CONTENT_ROOT, f)}`);
      r.fixed.forEach((x) => console.log(`    + ${x}`));
    }
    for (const s of r.skipped) {
      const key = s.split(":")[0];
      skippedSummary.set(key, (skippedSummary.get(key) ?? 0) + 1);
    }
  }

  console.log(`\n${totalFiles} files modified, ${totalFixed} fields fixed.`);
  if (skippedSummary.size > 0) {
    console.log(`Unfixable (need manual attention):`);
    for (const [k, v] of skippedSummary) console.log(`  • ${k}: ${v} files`);
  }
}

main();
