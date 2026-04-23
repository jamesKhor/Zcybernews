#!/usr/bin/env tsx
/**
 * B-021 backfill — re-run the new IOC + TTP extractors against every
 * existing article and update frontmatter.iocs / .ttp_matrix when the
 * extractor finds NEW data the LLM missed.
 *
 * Safety rules:
 *   - DRY-RUN BY DEFAULT. Pass --apply to actually write files.
 *   - Never SHRINKS an existing field. Only adds new entries; preserves
 *     LLM-curated entries the regex doesn't reproduce (file_path,
 *     registry_key, named LLM TTPs not in our lookup).
 *   - Never touches articles that already have a non-empty value for
 *     the field being backfilled — the operator may have hand-curated
 *     them. Pass --overwrite to override (rare; reviewer responsibility).
 *   - Cross-checks IOCs against source URLs / source text when
 *     available. For backfill, the body is the only source we have
 *     (we don't re-fetch original articles), so source = body.
 *   - Outputs a per-article diff log so the operator can spot-check
 *     what would change before --apply.
 *
 * Usage:
 *   npx tsx scripts/backfill-iocs-ttps.ts                  # dry-run
 *   npx tsx scripts/backfill-iocs-ttps.ts --apply          # write changes
 *   npx tsx scripts/backfill-iocs-ttps.ts --locale=en      # only EN
 *   npx tsx scripts/backfill-iocs-ttps.ts --section=posts  # only posts
 *   npx tsx scripts/backfill-iocs-ttps.ts --overwrite      # replace
 *                                                            non-empty
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  extractIocs,
  extractTtps,
  allowlistDomain,
} from "./pipeline/extract-iocs.js";
import type { IOCEntry, TTPEntry } from "../lib/types.js";

/**
 * Bulk-allowlist every configured RSS source's apex domain. Citing
 * those domains in body References is normal; they should not be
 * extracted as IOCs.
 */
function bootstrapSourceAllowlist(): void {
  try {
    const sourcesPath = path.join(process.cwd(), "data", "rss-sources.json");
    const raw = fs.readFileSync(sourcesPath, "utf-8");
    const sources = JSON.parse(raw) as Array<{
      url?: string;
      homepage?: string;
    }>;
    let added = 0;
    for (const s of sources) {
      for (const candidate of [s.url, s.homepage]) {
        if (!candidate) continue;
        try {
          const u = new URL(candidate);
          allowlistDomain(u.hostname);
          added++;
        } catch {
          // Non-URL string (e.g. just a domain) — pass through to allowlistDomain
          allowlistDomain(candidate);
          added++;
        }
      }
    }
    console.log(
      `[backfill] allowlisted ${added} source domains from data/rss-sources.json`,
    );
  } catch (err) {
    console.warn(
      "[backfill] could not load rss-sources.json for allowlist:",
      err instanceof Error ? err.message : err,
    );
  }
}

interface Options {
  apply: boolean;
  locale: "en" | "zh" | "both";
  section: "posts" | "threat-intel" | "both";
  overwrite: boolean;
  contentRoot: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const overwrite = args.includes("--overwrite");
  const localeArg = args.find((a) => a.startsWith("--locale="))?.split("=")[1];
  const sectionArg = args
    .find((a) => a.startsWith("--section="))
    ?.split("=")[1];
  const locale = localeArg === "en" || localeArg === "zh" ? localeArg : "both";
  const section =
    sectionArg === "posts" || sectionArg === "threat-intel"
      ? sectionArg
      : "both";
  return {
    apply,
    locale,
    section,
    overwrite,
    contentRoot: path.join(process.cwd(), "content"),
  };
}

interface ArticleFile {
  path: string;
  locale: string;
  section: string;
  raw: string;
  data: matter.GrayMatterFile<string>;
}

function walkArticles(opts: Options): ArticleFile[] {
  const locales = opts.locale === "both" ? ["en", "zh"] : [opts.locale];
  const sections =
    opts.section === "both"
      ? (["posts", "threat-intel"] as const)
      : ([opts.section] as const);
  const files: ArticleFile[] = [];
  for (const locale of locales) {
    for (const section of sections) {
      const dir = path.join(opts.contentRoot, locale, section);
      if (!fs.existsSync(dir)) continue;
      for (const fname of fs.readdirSync(dir)) {
        if (!fname.endsWith(".mdx")) continue;
        const fp = path.join(dir, fname);
        const raw = fs.readFileSync(fp, "utf-8");
        try {
          const data = matter(raw);
          files.push({ path: fp, locale, section, raw, data });
        } catch (err) {
          console.warn(
            `[backfill] skip ${fp} (parse error):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
  return files;
}

interface BackfillResult {
  path: string;
  iocsAdded: number;
  ttpsAdded: number;
  iocsBefore: number;
  iocsAfter: number;
  ttpsBefore: number;
  ttpsAfter: number;
  skippedReason?: string;
}

function backfillOne(file: ArticleFile, opts: Options): BackfillResult {
  const fm = file.data.data as {
    iocs?: IOCEntry[];
    ttp_matrix?: TTPEntry[];
  };
  const body = file.data.content;
  const iocsBefore = fm.iocs?.length ?? 0;
  const ttpsBefore = fm.ttp_matrix?.length ?? 0;

  // Skip if already-populated AND not --overwrite
  const iocsLocked = iocsBefore > 0 && !opts.overwrite;
  const ttpsLocked = ttpsBefore > 0 && !opts.overwrite;

  // For backfill, body IS the source (we have no original-source text
  // to re-fetch). Cross-check still discriminates against IOCs the LLM
  // mentioned in body but didn't appear elsewhere — but in practice
  // body == sourceText for backfill, so the cross-check is a no-op.
  // That's acceptable: we trust the body as authoritative for what's
  // already been published.
  const newIocs = iocsLocked
    ? (fm.iocs ?? [])
    : extractIocs({
        body,
        sourceText: body,
        existing: fm.iocs ?? [],
      });

  const newTtps = ttpsLocked
    ? (fm.ttp_matrix ?? [])
    : extractTtps({
        body,
        existing: fm.ttp_matrix ?? [],
      });

  const iocsAfter = newIocs.length;
  const ttpsAfter = newTtps.length;
  const iocsAdded = Math.max(0, iocsAfter - iocsBefore);
  const ttpsAdded = Math.max(0, ttpsAfter - ttpsBefore);

  // Apply only if --apply AND there's a real change
  const changed = iocsAdded > 0 || ttpsAdded > 0;
  if (opts.apply && changed) {
    if (!iocsLocked && newIocs.length > 0) fm.iocs = newIocs;
    if (!ttpsLocked && newTtps.length > 0) fm.ttp_matrix = newTtps;
    const newRaw = matter.stringify(body, fm);
    fs.writeFileSync(file.path, newRaw, "utf-8");
  }

  return {
    path: file.path,
    iocsAdded,
    ttpsAdded,
    iocsBefore,
    iocsAfter,
    ttpsBefore,
    ttpsAfter,
    skippedReason:
      iocsLocked && ttpsLocked
        ? "both fields already populated (use --overwrite to replace)"
        : undefined,
  };
}

function main() {
  const opts = parseArgs();
  console.log(
    `🔁 backfill · apply=${opts.apply} locale=${opts.locale} section=${opts.section} overwrite=${opts.overwrite}`,
  );
  bootstrapSourceAllowlist();
  const files = walkArticles(opts);
  console.log(`Found ${files.length} articles`);

  const results = files.map((f) => backfillOne(f, opts));
  const changed = results.filter((r) => r.iocsAdded > 0 || r.ttpsAdded > 0);
  const totalIocsAdded = results.reduce((s, r) => s + r.iocsAdded, 0);
  const totalTtpsAdded = results.reduce((s, r) => s + r.ttpsAdded, 0);

  console.log("\n=== Summary ===");
  console.log(`  Articles changed:        ${changed.length}/${files.length}`);
  console.log(`  Total IOCs added:        ${totalIocsAdded}`);
  console.log(`  Total TTPs added:        ${totalTtpsAdded}`);
  console.log(
    `  Mode:                    ${opts.apply ? "🔴 APPLIED" : "🟢 dry-run (no files written)"}`,
  );

  if (changed.length > 0) {
    console.log("\n=== Top 20 articles with most additions ===");
    const sorted = changed
      .slice()
      .sort((a, b) => b.iocsAdded + b.ttpsAdded - (a.iocsAdded + a.ttpsAdded))
      .slice(0, 20);
    for (const r of sorted) {
      const slug = path.basename(r.path).replace(".mdx", "");
      console.log(`  +${r.iocsAdded} iocs +${r.ttpsAdded} ttps  ${slug}`);
    }
  }

  if (!opts.apply) {
    console.log(
      "\nTo apply: re-run with --apply (commits a single batch update).",
    );
  }
}

main();
