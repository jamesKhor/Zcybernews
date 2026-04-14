#!/usr/bin/env tsx
/**
 * Local test for the shift-left + shift-right safety filters.
 *
 * Runs against the LIVE content/ directory. No network calls. No writes.
 * Exits 0 on all-pass, 1 on any failure.
 *
 * Usage: npx tsx scripts/test-safety-filters.ts
 *
 * What it covers:
 *   1. Word-similarity threshold catches near-duplicates
 *   2. Slug-prefix overlap catches paraphrased headlines
 *   3. Shared CVE catches the "same vuln, different title" case
 *   4. Stop-words don't inflate similarity (the / a / and don't count)
 *   5. findDuplicateOnDisk catches a generated article matching real content
 *   6. findDuplicateOnDisk returns null for genuinely new content
 *   7. SLUG_PREFIX_OVERLAP catches the actual Agentic AI scenario
 */

import {
  titleSimilarity,
  shareSlugPrefix,
  meaningfulWords,
  deduplicate,
  findDuplicateOnDisk,
  loadAllPublished,
  claimInFlight,
  releaseInFlight,
  _clearInFlight,
  _clearPublishedCache,
  SIMILARITY_THRESHOLD,
  type Story,
} from "./utils/dedup.js";

let passed = 0;
let failed = 0;

function test(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? "  → " + detail : ""}`);
    failed++;
  }
}

function suite(name: string, fn: () => void) {
  console.log(`\n=== ${name} ===`);
  fn();
}

// ─── Suite 1: titleSimilarity behavior ─────────────────────────────────────
suite("titleSimilarity", () => {
  const a = "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat";
  const b =
    "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat to Enterprises";
  // Same vocabulary, rearranged — what Jaccard SHOULD catch
  const c = "Cross-Session, Cross-User Threat: Agentic AI Memory Attacks";
  const d = "CISA Flags Six Actively Exploited Flaws";
  // Genuinely different paraphrase using different vocabulary —
  // what Jaccard CAN'T catch (Tier 3 / embedding territory). We document
  // this limitation explicitly so future reviewers know shift-left/right
  // is not a substitute for semantic dedup.
  const e = "Memory Poisoning Attacks Threaten AI Agents Across User Sessions";

  const sAB = titleSimilarity(a, b);
  const sAC = titleSimilarity(a, c);
  const sAD = titleSimilarity(a, d);
  const sAE = titleSimilarity(a, e);

  test(
    "Identical-prefix titles score very high",
    sAB >= 0.7,
    `got ${sAB.toFixed(3)}`,
  );
  test(
    "Word-rearranged same-vocab titles score above threshold",
    sAC >= SIMILARITY_THRESHOLD,
    `got ${sAC.toFixed(3)}, threshold ${SIMILARITY_THRESHOLD}`,
  );
  test(
    "Unrelated titles score below threshold",
    sAD < SIMILARITY_THRESHOLD,
    `got ${sAD.toFixed(3)}`,
  );
  test(
    "DOCUMENTED LIMIT: deeply-paraphrased titles slip through Jaccard",
    sAE < SIMILARITY_THRESHOLD,
    `got ${sAE.toFixed(3)} — this is expected; Tier 3 (semantic embeddings) needed to catch this`,
  );
});

// ─── Suite 2: stop words don't inflate similarity ──────────────────────────
suite("Stop word handling", () => {
  const a = "The new study shows Microsoft and Google are at risk";
  const b = "A new report reveals Apple and Cisco are at risk";

  // Without stop word filtering, "the/a/and/are/at" would inflate overlap
  // After filtering: a → [microsoft, google, risk], b → [apple, cisco, risk]
  // Overlap = 1, union = 5, similarity = 0.2 (low — different companies)
  const sim = titleSimilarity(a, b);
  test(
    "Different companies, same filler — low similarity",
    sim < 0.3,
    `got ${sim.toFixed(3)}`,
  );

  const wordsA = meaningfulWords(a);
  test(
    "Stop words removed from word list",
    !wordsA.includes("the") && !wordsA.includes("and"),
    `got: ${wordsA.join(",")}`,
  );
});

// ─── Suite 3: shareSlugPrefix catches the Agentic AI case ──────────────────
suite("shareSlugPrefix", () => {
  const a = "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat";
  const b =
    "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat to Enterprises";
  const c = "Memory Attacks Target Enterprise Customers";

  test("Same first 4 meaningful words → match", shareSlugPrefix(a, b));
  test(
    "Different first words → no match",
    !shareSlugPrefix(a, c),
    `meaningfulWords(a)=${meaningfulWords(a).slice(0, 4).join(",")}, meaningfulWords(c)=${meaningfulWords(c).slice(0, 4).join(",")}`,
  );
});

// ─── Suite 4: deduplicate() catches the duplicate ──────────────────────────
suite("deduplicate (RSS-side, shift-left within-batch)", () => {
  const stories: Story[] = [
    {
      id: "1",
      title: "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat",
      url: "https://example.com/article-1",
      excerpt: "Cisco researcher details MemoryTrap...",
      sourceName: "TheHackerNews",
      publishedAt: "2026-04-14T10:00:00Z",
      tags: [],
    },
    {
      id: "2",
      title:
        "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat to Enterprises",
      url: "https://example.com/article-2-different-url",
      excerpt: "Same news, different source phrasing...",
      sourceName: "BleepingComputer",
      publishedAt: "2026-04-14T11:00:00Z",
      tags: [],
    },
    {
      id: "3",
      title: "Microsoft Patches Three Zero-Day Vulnerabilities",
      url: "https://example.com/article-3",
      excerpt: "Patch Tuesday includes...",
      sourceName: "BleepingComputer",
      publishedAt: "2026-04-14T12:00:00Z",
      tags: [],
    },
  ];

  const deduped = deduplicate(stories);
  test(
    "Within-batch dedup catches Agentic AI duplicate",
    deduped.length === 2,
    `Expected 2 stories after dedup, got ${deduped.length}`,
  );
  test("First story is kept", deduped[0]?.id === "1");
  test(
    "Microsoft story (genuinely different) is kept",
    deduped.some((s) => s.id === "3"),
  );
});

// ─── Suite 5: shared-CVE dedup ─────────────────────────────────────────────
suite("Shared-CVE dedup", () => {
  const stories: Story[] = [
    {
      id: "a",
      title: "Critical Apache Vulnerability Exploited in the Wild",
      url: "https://example.com/a",
      excerpt: "Attackers exploiting CVE-2026-12345 in Apache...",
      sourceName: "TheHackerNews",
      publishedAt: "2026-04-14T10:00:00Z",
      tags: [],
    },
    {
      id: "b",
      title: "Apache Maintainers Issue Emergency Patch",
      url: "https://example.com/b",
      excerpt: "Patch released for CVE-2026-12345 affecting all versions...",
      sourceName: "BleepingComputer",
      publishedAt: "2026-04-14T11:00:00Z",
      tags: [],
    },
  ];
  const deduped = deduplicate(stories);
  test(
    "Same CVE → caught as duplicate",
    deduped.length === 1,
    `got ${deduped.length}`,
  );
});

// ─── Suite 6: findDuplicateOnDisk against live content/ ────────────────────
suite("findDuplicateOnDisk (shift-right vs live disk)", () => {
  const allPublished = loadAllPublished();
  test(
    "loadAllPublished returns at least 1 article (sanity)",
    allPublished.length > 0,
    `got ${allPublished.length} articles`,
  );

  if (allPublished.length === 0) return;

  // Pick a real published article and try to "re-publish" it with a tweaked title
  const sample = allPublished[0]!;

  const generatedDup = findDuplicateOnDisk({
    title: sample.title,
    slug: "2026-04-14-some-other-slug",
    body: "",
  });
  test(
    "Exact-title match → caught",
    generatedDup !== null && generatedDup.matchType === "title-similarity",
    `match: ${JSON.stringify(generatedDup)}`,
  );

  // Same article with paraphrased title
  const tweakedTitle = sample.title.replace(/\bthe\b/i, "a");
  const generatedTweaked = findDuplicateOnDisk({
    title: tweakedTitle,
    slug: "2026-04-14-totally-different-slug",
    body: "",
  });
  test("Stop-word-tweaked title → still caught", generatedTweaked !== null);

  // Genuinely new article
  const generatedNew = findDuplicateOnDisk({
    title:
      "Highly Specific Brand New Cybersecurity Topic Nobody Wrote About Yet 2099",
    slug: "2099-12-31-totally-unique-slug-never-seen",
    body: "",
  });
  test(
    "Genuinely-new article → no match",
    generatedNew === null,
    generatedNew ? `false-positive: ${JSON.stringify(generatedNew)}` : "",
  );

  // Exact slug match
  const generatedExactSlug = findDuplicateOnDisk({
    title: "Different title entirely",
    slug: sample.slug,
    body: "",
  });
  test(
    "Exact-slug match → caught with type 'exact-slug'",
    generatedExactSlug !== null &&
      generatedExactSlug.matchType === "exact-slug",
  );
});

// ─── Suite 7: the actual Agentic AI scenario ───────────────────────────────
suite("Agentic AI Memory Attacks (the original incident)", () => {
  const generated = findDuplicateOnDisk({
    title: "Agentic AI Memory Attacks Pose Cross-Session, Cross-User Threat",
    slug: "2026-04-14-agentic-ai-memory-attacks-threat-cross-session",
    body: "Cisco researcher details MemoryTrap, an attack method...",
  });
  test(
    "Today's incident reproducer → would be blocked by shift-right",
    generated !== null,
    generated ? `match type: ${generated.matchType}` : "no match found",
  );
});

// ─── Suite 8: in-flight registry (concurrent generation race) ──────────────
suite("In-flight registry (concurrency)", () => {
  _clearInFlight();
  const claim1 = claimInFlight({
    title: "Critical Apache RCE Discovered",
    slug: "2026-04-14-critical-apache-rce-discovered",
  });
  test("First claim succeeds", claim1.claimed === true);

  // Second concurrent task tries the SAME title — should fail
  const claim2 = claimInFlight({
    title: "Critical Apache RCE Discovered",
    slug: "2026-04-14-different-slug-same-title",
  });
  test(
    "Same-title second claim is rejected",
    claim2.claimed === false,
    JSON.stringify(claim2),
  );

  // Different title and slug — should succeed (no collision)
  const claim3 = claimInFlight({
    title: "Microsoft Patches Three Vulnerabilities",
    slug: "2026-04-14-microsoft-patches-three-vulnerabilities",
  });
  test(
    "Genuinely-different concurrent claim succeeds",
    claim3.claimed === true,
  );

  releaseInFlight({
    title: "Critical Apache RCE Discovered",
    slug: "2026-04-14-critical-apache-rce-discovered",
  });

  // After release, same title can be claimed again
  const claim4 = claimInFlight({
    title: "Critical Apache RCE Discovered",
    slug: "2026-04-14-critical-apache-rce-discovered",
  });
  test("After release, same title claimable again", claim4.claimed === true);

  _clearInFlight();
});

// ─── Suite 9: gray-matter handles tricky frontmatter ───────────────────────
suite("Frontmatter parser (gray-matter, not regex)", () => {
  // Verify the loader returns sensible results for every published article.
  // If gray-matter handles a tricky title like "Apple's Patch: A Breakdown"
  // correctly, the title contains the colon AND the apostrophe.
  const all = loadAllPublished();
  let hasTrickyTitle = false;
  for (const a of all) {
    if (
      a.title.includes(":") ||
      a.title.includes("'") ||
      a.title.includes('"')
    ) {
      hasTrickyTitle = true;
      // If gray-matter parsed wrong, the title might be truncated at the colon
      // or contain literal quote characters. Verify it's at least 5 chars.
      test(
        `Tricky title parsed correctly: "${a.title}" (length ${a.title.length})`,
        a.title.length >= 5 && !a.title.startsWith('"'),
      );
      break; // one example is enough
    }
  }
  if (!hasTrickyTitle) {
    test(
      "(skipped: no tricky title in current corpus)",
      true,
      "no titles with ':, ', or \" found",
    );
  }
});

// ─── Suite 10: memo cache invalidation ─────────────────────────────────────
suite("Memo cache (perf)", () => {
  _clearPublishedCache();
  const t0 = Date.now();
  const first = loadAllPublished();
  const t1 = Date.now();
  const second = loadAllPublished();
  const t2 = Date.now();

  test("First call returns articles", first.length > 0, `got ${first.length}`);
  test(
    "Second call returns same articles (cache hit)",
    second.length === first.length,
  );
  // Cache hit should be MUCH faster than fresh read
  test(
    "Cache hit is faster than first read",
    t2 - t1 <= t1 - t0,
    `first=${t1 - t0}ms, second=${t2 - t1}ms`,
  );
});

// ─── Final report ──────────────────────────────────────────────────────────
console.log(
  `\n${failed === 0 ? "🎉" : "❌"} ${passed} passed, ${failed} failed`,
);
process.exit(failed === 0 ? 0 : 1);
