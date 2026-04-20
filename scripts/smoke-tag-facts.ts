/**
 * Smoke test — tag-intro pipeline.
 *
 * Validates:
 *   A. aggregate-facts output shape + live content consistency
 *      - every indexable tag (count ≥ 5) has a JSON file for each locale that has articles
 *      - counts in JSON match live tag membership
 *      - NO thin tags (count < 5) leak into output
 *      - sources_hash is stable across two consecutive runs
 *   B. fact-check guard rejects hallucinated CVEs (fixture-based, no LLM)
 *   C. fact-check guard rejects wrong word counts + banned phrases
 *
 * Run: npx tsx scripts/smoke-tag-facts.ts
 */
import fs from "fs";
import path from "path";
import { getAllPosts } from "../lib/content.js";
import { aggregateLocale } from "./tag-intros/aggregate-facts.js";
import { checkTagIntro } from "./tag-intros/fact-check.js";
import type { TagFactSheet } from "./tag-intros/types.js";
import { MIN_TAG_COUNT } from "./tag-intros/types.js";

type Locale = "en" | "zh";

function sanitize(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildLiveTagCounts(locale: Locale): Map<string, number> {
  const posts = getAllPosts(locale, "posts");
  const ti = getAllPosts(locale, "threat-intel");
  const map = new Map<string, number>();
  for (const a of [...posts, ...ti]) {
    for (const tag of a.frontmatter.tags ?? []) {
      const key = tag.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

function fail(msg: string): never {
  console.error(`❌ SMOKE FAIL: ${msg}`);
  process.exit(1);
}

async function testA_aggregate() {
  console.log(
    "\n── Test A: aggregate-facts shape + content match ──────────────",
  );
  for (const locale of ["en", "zh"] as const) {
    const live = buildLiveTagCounts(locale);
    const expectedIndexable = Array.from(live.entries()).filter(
      ([, n]) => n >= MIN_TAG_COUNT,
    );
    console.log(
      `  ${locale}: live indexable tags = ${expectedIndexable.length}`,
    );

    const run1 = aggregateLocale(locale);
    const run2 = aggregateLocale(locale);

    if (run1.length !== expectedIndexable.length) {
      fail(
        `${locale}: expected ${expectedIndexable.length} sheets, got ${run1.length}`,
      );
    }

    // Thin-tag leak check
    for (const sheet of run1) {
      if (sheet.count < MIN_TAG_COUNT) {
        fail(
          `${locale}: thin tag leaked into output: ${sheet.tag} (count ${sheet.count})`,
        );
      }
      const liveCount = live.get(sheet.tag);
      if (liveCount !== sheet.count) {
        fail(
          `${locale}/${sheet.tag}: sheet count ${sheet.count} != live count ${liveCount}`,
        );
      }
      // JSON file must exist
      const file = path.join(
        process.cwd(),
        "data",
        "tag-facts",
        locale,
        sanitize(sheet.tag) + ".json",
      );
      if (!fs.existsSync(file))
        fail(`${locale}/${sheet.tag}: JSON file not written at ${file}`);
    }

    // Hash stability
    const byTag1 = new Map(run1.map((s) => [s.tag, s.sources_hash]));
    for (const s of run2) {
      if (byTag1.get(s.tag) !== s.sources_hash) {
        fail(
          `${locale}/${s.tag}: sources_hash unstable across runs (${byTag1.get(s.tag)} vs ${s.sources_hash})`,
        );
      }
    }
    console.log(
      `  ${locale}: ✅ ${run1.length} sheets, counts match, hashes stable, no thin-tag leak`,
    );
  }
}

function mockSheet(overrides: Partial<TagFactSheet> = {}): TagFactSheet {
  return {
    tag: "ransomware",
    locale: "en",
    count: 20,
    date_range: { first: "2026-01-01", latest: "2026-04-19" },
    top_actors: ["LockBit", "BlackCat"],
    top_cves: [{ id: "CVE-2026-12345", cvss: 9.8 }],
    top_sectors: ["healthcare"],
    top_regions: ["North America"],
    severity_mix: { critical: 5, high: 10 },
    recent_excerpts: [],
    sources_hash: "abcd1234",
    ...overrides,
  };
}

function testB_factcheckRejectsBadCve() {
  console.log(
    "\n── Test B: fact-check rejects hallucinated CVE ─────────────────",
  );
  const sheet = mockSheet();
  const bad =
    `Across 20 reports since January 2026, this tag tracks activity tied to LockBit and BlackCat. ` +
    `Recent disclosures include CVE-2026-12345 with a CVSS of 9.8, alongside a fabricated CVE-2099-99999 that should be caught by fact-check. ` +
    `Healthcare organizations across North America remain the primary target, with critical and high severity dominating the severity mix throughout the period under review by our team every week.`;
  const r = checkTagIntro(bad, sheet, { locale: "en" });
  const hit = r.issues.find(
    (i) => i.type === "cve_not_in_sheet" && i.value === "CVE-2099-99999",
  );
  if (!hit) fail("fact-check failed to flag hallucinated CVE-2099-99999");
  if (r.passed) fail("fact-check passed an intro with a hallucinated CVE");
  console.log(`  ✅ rejected: ${hit.message}`);
}

function testC_factcheckRejectsBannedAndCount() {
  console.log(
    "\n── Test C: fact-check rejects banned phrases + bad word count ──",
  );
  const sheet = mockSheet();

  // Too short
  const tiny = "Ransomware is an emerging threat.";
  const rTiny = checkTagIntro(tiny, sheet, { locale: "en" });
  if (rTiny.passed) fail("fact-check passed a 5-word intro");
  const wc = rTiny.issues.find((i) => i.type === "word_count_out_of_range");
  const ban = rTiny.issues.find((i) => i.type === "banned_phrase");
  if (!wc) fail("word_count_out_of_range not flagged on tiny intro");
  if (!ban) fail('banned_phrase "emerging threat" not flagged');
  console.log(`  ✅ tiny intro flagged (word count + banned phrase)`);

  // Happy path — grounded, within band
  const good =
    `Across 20 reports published between January and April 2026, this tag aggregates coverage of incidents tied to LockBit and BlackCat. ` +
    `Recorded disclosures include CVE-2026-12345 at CVSS 9.8. Healthcare organizations in North America account for the bulk of documented impact, ` +
    `with the severity mix skewing toward critical and high. The archive is updated as new reports land, and readers can use it to trace operator ` +
    `activity, campaign continuity, and affected geographies over the tracking window we maintain here for ongoing reference purposes across the year.`;
  const rGood = checkTagIntro(good, sheet, { locale: "en" });
  if (!rGood.passed)
    fail(
      `happy-path intro unexpectedly failed: ${JSON.stringify(rGood.issues)}`,
    );
  console.log(`  ✅ happy-path intro passed (${rGood.wordCount} words)`);
}

async function main() {
  await testA_aggregate();
  testB_factcheckRejectsBadCve();
  testC_factcheckRejectsBannedAndCount();
  console.log("\n✅ ALL SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
