/**
 * Post-process — runs AFTER article generation, BEFORE fact-check + write.
 *
 * Implements the core principle: "LLM writes prose, script extracts
 * structured data." Instead of trusting the LLM to fill structured fields
 * (slug, date, cve_ids, iocs) correctly, we derive them deterministically
 * from the generated body + source material.
 *
 * This prevents:
 *   - Hallucinated CVE IDs (LLM invents CVE-2026-XXXXX)
 *   - Slug drift (LLM generates slug that doesn't match title)
 *   - Wrong dates (LLM puts source article's date instead of today)
 *   - Duplicate or non-normalized tags
 *
 * Idempotent — safe to run multiple times.
 */
import fs from "node:fs";
import path from "node:path";
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import type { Story } from "../utils/dedup.js";

// ── Regex (shared with fact-check) ────────────────────────────────────────

const CVE_REGEX = /CVE-\d{4}-\d{4,}/g;
// Catches prompt placeholders the LLM was told to use as fallback but
// shouldn't literal-copy: CVE-2026-XXXXX, CVE-YYYY-NNNNN, CVE-2026-?????,
// CVE-XXXX-XXXXX. Real CVEs have digits after the year; placeholders
// have letters or question marks. Used to detect + recover, not just flag.
const CVE_PLACEHOLDER_REGEX =
  /CVE-(?:\d{4}|[A-Z]{4})-(?:[XNY?]{2,}|[A-Z]{5})/gi;
const MD5_REGEX = /\b[a-fA-F0-9]{32}\b/g;
const SHA1_REGEX = /\b[a-fA-F0-9]{40}\b/g;
const SHA256_REGEX = /\b[a-fA-F0-9]{64}\b/g;
const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

// CVSS score extraction — matches "CVSS 9.8", "CVSS score of 9.8",
// "CVSSv3.1: 9.8", "base score 9.8", etc. Captures just the number.
const CVSS_REGEX =
  /CVSS(?:\s*v?[234]\.?[01]?)?\s*(?:score|base(?:\s*score)?)?\s*(?:of|:|=|is|at|hit|reached|carries|rated)?\s*(\d+(?:\.\d+)?)/gi;

// ── Known threat actors (loaded once, lazy) ──────────────────────────────

type ThreatActorEntry = { canonical: string; aliases: string[] };
let THREAT_ACTORS: ThreatActorEntry[] | null = null;

function loadThreatActors(): ThreatActorEntry[] {
  if (THREAT_ACTORS) return THREAT_ACTORS;
  try {
    const filePath = path.resolve(
      process.cwd(),
      "data/known-threat-actors.json",
    );
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { actors?: ThreatActorEntry[] };
    THREAT_ACTORS = parsed.actors ?? [];
  } catch {
    THREAT_ACTORS = [];
  }
  return THREAT_ACTORS;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a title string.
 *
 * Rules (chosen to match what the pipeline has historically produced so
 * existing links don't break):
 *   - lowercase
 *   - strip non-ASCII (prevents Chinese titles producing unicode slugs)
 *   - collapse whitespace + punctuation to a single hyphen
 *   - trim leading/trailing hyphens
 *   - truncate to 80 chars at a word boundary
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\x20-\x7e]/g, "") // strip non-ASCII
    .replace(/['']/g, "") // strip apostrophes
    .replace(/[^a-z0-9]+/g, "-") // non-alphanum → hyphen
    .replace(/^-+|-+$/g, "") // trim hyphens
    .slice(0, 80)
    .replace(/-+$/, ""); // re-trim after slice
}

function uniqueMatches(str: string, re: RegExp): string[] {
  const m = str.match(re) ?? [];
  return Array.from(new Set(m));
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/\s+/g, " ");
  return h.includes(n);
}

function buildSourceCorpus(sources: Story[]): string {
  return sources.map((s) => `${s.title} ${s.excerpt ?? ""}`).join("\n");
}

/**
 * Extract a CVSS score from article body + cross-check against sources.
 * Returns the numeric score (0.0-10.0) if found in BOTH body and source
 * text, else null. Cross-checking prevents the LLM from inventing a score
 * that doesn't appear in the real reporting.
 */
export function extractCvssScore(
  body: string,
  sourceText: string,
): number | null {
  const scores = new Set<number>();
  let match;
  // Reset regex state (global + /g regexes are stateful)
  CVSS_REGEX.lastIndex = 0;
  while ((match = CVSS_REGEX.exec(body)) !== null) {
    const n = parseFloat(match[1]);
    if (!isNaN(n) && n >= 0 && n <= 10) scores.add(n);
  }
  if (scores.size === 0) return null;

  // Cross-check: for each candidate score found in body, confirm it also
  // appears in source text (same regex). Otherwise we'd accept LLM's
  // hallucinated score.
  const sourceScores = new Set<number>();
  CVSS_REGEX.lastIndex = 0;
  while ((match = CVSS_REGEX.exec(sourceText)) !== null) {
    const n = parseFloat(match[1]);
    if (!isNaN(n) && n >= 0 && n <= 10) sourceScores.add(n);
  }

  // Return the highest body-score that's verified by sources
  const verified = [...scores].filter((s) => sourceScores.has(s));
  if (verified.length === 0) return null;
  return Math.max(...verified);
}

/**
 * Aliases that collide with common English words. Matching these requires
 * a nearby threat-intel context word in the same sentence; otherwise we
 * get false positives like "play" (verb) → "Play" (ransomware).
 */
const AMBIGUOUS_ALIASES = new Set([
  "play",
  "hive",
  "medusa",
  "akira",
  "royal",
  "conti",
  "agenda",
  "muddled libra",
]);

/**
 * Keywords that signal the surrounding sentence is about a threat actor.
 * Used to validate matches against AMBIGUOUS_ALIASES.
 */
const ACTOR_CONTEXT_WORDS = [
  "ransomware",
  "ransom",
  "gang",
  "group",
  "actor",
  "apt",
  "threat",
  "campaign",
  "operator",
  "affiliate",
  "exfiltrat",
  "encrypt",
  "deploy",
  "targets",
  "claimed",
  "attribut",
  "adversary",
  "syndicate",
];

/**
 * Extract the canonical threat-actor name from article body using the
 * curated list in `data/known-threat-actors.json`. Case-insensitive
 * whole-phrase match. Returns the canonical form (e.g. "LockBit 4.0" in
 * body → "LockBit" canonical) or null if no known actor is found.
 *
 * For ambiguous aliases that collide with common English words (see
 * AMBIGUOUS_ALIASES), requires a threat-actor context keyword within
 * ±120 chars of the match. This prevents "play" in a sentence like
 * "users play video" from matching the Play ransomware group.
 *
 * Why whole-phrase not substring: avoids false positives like "APT" matching
 * inside "ADAPTAVIST". Each alias match requires word boundaries.
 */
export function extractThreatActor(body: string): string | null {
  const actors = loadThreatActors();
  if (actors.length === 0) return null;

  for (const entry of actors) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isAmbiguous = AMBIGUOUS_ALIASES.has(alias.toLowerCase());
      // Ambiguous aliases (collide with common English words) require an
      // exact-case match AND a threat-context word within ±60 chars.
      // Non-ambiguous aliases use case-insensitive match.
      const re = new RegExp(`\\b${escaped}\\b`, isAmbiguous ? "" : "i");
      const m = re.exec(body);
      if (!m) continue;

      if (isAmbiguous) {
        const start = Math.max(0, m.index - 60);
        const end = Math.min(body.length, m.index + alias.length + 60);
        const window = body.slice(start, end).toLowerCase();
        const hasContext = ACTOR_CONTEXT_WORDS.some((w) => window.includes(w));
        if (!hasContext) continue;
      }

      return entry.canonical;
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Post-process a generated article. Mutates and returns the same object.
 *
 * Overrides LLM output for structured fields where a deterministic value
 * is safer than a generated one.
 *
 * Note: the article's `date` is set inside write-mdx.ts (not part of
 * GeneratedArticleSchema) so we don't touch it here.
 */
export function postProcessArticle(
  article: GeneratedArticle,
  sources: Story[],
): GeneratedArticle {
  const sourceText = buildSourceCorpus(sources);

  // ── 1. Slug — always derived from title ────────────────────────────────
  // Reason: LLM sometimes drops words or adds date prefix or typos.
  article.slug = slugify(article.title);

  // ── 2. cve_ids — rebuild from body + cross-check with sources ──────────
  // Only keep CVEs that appear BOTH in the article body AND in source
  // material. This prevents the LLM from inventing a plausible-looking
  // CVE ID that doesn't exist in the real reporting.
  const bodyCves = uniqueMatches(article.body, CVE_REGEX);
  const sourceCves = uniqueMatches(sourceText.toUpperCase(), CVE_REGEX);
  article.cve_ids = bodyCves.filter((c) => sourceCves.includes(c));

  // ── 2a. CVE placeholder recovery — catch CVE-2026-XXXXX etc ────────────
  // The LLM sometimes literal-copies the prompt's fallback token into the
  // body (bug observed 2026-04-20 on syncthing article). Flow:
  //   1. Scan body for placeholder pattern.
  //   2. If present AND source text contains a real CVE → swap in source CVE.
  //   3. If present AND no real CVE in sources → strip the entire sentence
  //      containing the placeholder (avoids dangling "a critical flaw," text).
  //   4. If sentence-strip leaves body unchanged, fact-check will reject.
  const placeholderMatches = Array.from(
    article.body.matchAll(CVE_PLACEHOLDER_REGEX),
  );
  if (placeholderMatches.length > 0) {
    const realSourceCve = sourceCves[0]; // first real CVE in sources, if any
    if (realSourceCve) {
      // Recovery path: swap placeholder → real CVE from source
      article.body = article.body.replace(CVE_PLACEHOLDER_REGEX, realSourceCve);
      if (!article.cve_ids.includes(realSourceCve)) {
        article.cve_ids = [...article.cve_ids, realSourceCve];
      }
    } else {
      // No real CVE to swap in — remove sentences that contain a placeholder.
      // Conservative: split on /[.!?]\s+/, drop sentences with a placeholder,
      // rejoin. Fact-check will still reject if any placeholder survives.
      article.body = article.body
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !CVE_PLACEHOLDER_REGEX.test(s))
        .join(" ");
      // Reset regex lastIndex after use (test() on /g regex is stateful)
      CVE_PLACEHOLDER_REGEX.lastIndex = 0;
    }
  }

  // ── 2aa. Scrub placeholder tags from frontmatter ──────────────────────
  // The LLM also slugs placeholders into tags (e.g. "cve-2026-xxxxx").
  // Drop any tag matching the placeholder pattern — they never lead to
  // useful tag archives.
  if (article.tags) {
    article.tags = article.tags.filter(
      (t) => !/^cve-(?:\d{4}|[a-z]{4})-(?:[xny?]{2,}|[a-z]{5})$/i.test(t),
    );
  }

  // ── 2ab. Scrub placeholder from excerpt/title ─────────────────────────
  // LLM sometimes lands the placeholder in the excerpt/title too (e.g.
  // syncthing article 2026-04-20). Apply same recovery rule: swap if a
  // real CVE exists in sources, otherwise strip the token entirely (and
  // collapse ", ," artifacts).
  const realSourceCveForMeta = sourceCves[0];
  for (const field of ["excerpt", "title"] as const) {
    const v = article[field];
    if (typeof v === "string" && CVE_PLACEHOLDER_REGEX.test(v)) {
      CVE_PLACEHOLDER_REGEX.lastIndex = 0;
      if (realSourceCveForMeta) {
        article[field] = v.replace(CVE_PLACEHOLDER_REGEX, realSourceCveForMeta);
      } else {
        article[field] = v
          .replace(CVE_PLACEHOLDER_REGEX, "")
          .replace(/,\s*,/g, ",")
          .replace(/\s{2,}/g, " ")
          .replace(/\s+([,.])/g, "$1")
          .trim();
      }
      CVE_PLACEHOLDER_REGEX.lastIndex = 0;
    }
  }

  // ── 2b. cvss_score — derive from body + verify against sources ────────
  // Phase P-A enrichment (2026-04-18). Previously the LLM emitted
  // cvss_score on only ~7% of articles even when sources clearly named
  // a score. Body-regex + source cross-check is script-cheap and reliable.
  // Only overrides LLM value if we found a higher-confidence match.
  const scriptedCvss = extractCvssScore(article.body, sourceText);
  if (scriptedCvss !== null) {
    // If LLM didn't provide one, set from script.
    // If LLM provided one, prefer the script's value since it's cross-
    // checked against sources.
    article.cvss_score = scriptedCvss;
  }

  // ── 2c. threat_actor — derive from body using known-actors list ───────
  // Phase P-A enrichment. LLM emits threat_actor on ~17% of articles.
  // The known-actors JSON lists ~70 canonical actors + aliases. If the
  // body mentions any known alias, we set the canonical name. Frontend
  // MalwareCard will show this big instead of guessing from title.
  if (!article.threat_actor) {
    const scripted = extractThreatActor(article.body);
    if (scripted) article.threat_actor = scripted;
  }

  // ── 4. IOCs — rebuild from body + cross-check with sources ─────────────
  // Only include hashes/IPs that appear in the body AND in source text.
  // Domains are harder to regex cleanly — we leave those to the LLM for
  // now but could add a TLD-bound regex later.
  const bodyHashes = [
    ...uniqueMatches(article.body, MD5_REGEX).map((h) => ({
      type: "hash_md5" as const,
      value: h,
    })),
    ...uniqueMatches(article.body, SHA1_REGEX).map((h) => ({
      type: "hash_sha1" as const,
      value: h,
    })),
    ...uniqueMatches(article.body, SHA256_REGEX).map((h) => ({
      type: "hash_sha256" as const,
      value: h,
    })),
  ];
  const bodyIps = uniqueMatches(article.body, IPV4_REGEX)
    .filter(
      (ip) =>
        !ip.startsWith("192.168.") &&
        !ip.startsWith("10.") &&
        ip !== "127.0.0.1",
    )
    .map((ip) => ({ type: "ip" as const, value: ip }));

  const verifiedIocs: typeof article.iocs = [];
  for (const ioc of [...bodyHashes, ...bodyIps]) {
    if (normalizedIncludes(sourceText, ioc.value)) {
      verifiedIocs.push({
        type: ioc.type,
        value: ioc.value,
        description: "Extracted from source material",
        confidence: "high",
      });
    }
  }
  // Preserve any LLM-provided IOCs that were domains/emails (types we don't regex)
  const nonRegexedIocs = (article.iocs ?? []).filter(
    (i) =>
      i.type !== "hash_md5" &&
      i.type !== "hash_sha1" &&
      i.type !== "hash_sha256" &&
      i.type !== "ip",
  );
  article.iocs = [...verifiedIocs, ...nonRegexedIocs];

  // ── 5. Tags — normalize (lowercase, hyphenate spaces, dedup, length cap) ──
  // Space-to-hyphen conversion is critical for URL routing. A tag like
  // "vulnerability management" produces the URL /en/tags/vulnerability%20management
  // which returns 404 (see Google Search Console 2026-04-18 — 1 page flagged
  // 404 for this exact reason). Route slug lookup keys by hyphenated form.
  if (Array.isArray(article.tags)) {
    const cleaned = article.tags
      .map((t) =>
        String(t).toLowerCase().trim().replace(/\s+/g, "-").replace(/-+/g, "-"),
      )
      .filter((t) => t.length > 0 && t.length < 40);
    article.tags = Array.from(new Set(cleaned));
  }

  // ── 6. Title — hard truncate to 70 chars (Google SERP truncates at ~60 ──
  // but allows 70 before snipping mid-word). Audit 2026-04-21 found 51% of
  // EN articles had titles >70 chars. Prompt says 50-60 but LLM ignores ~50%
  // of the time when content is dense. Enforce in code, not prompt.
  if (article.title.length > 70) {
    const cut = article.title.slice(0, 70).replace(/\s+\S*$/, "");
    article.title = (cut || article.title.slice(0, 70)).trim();
  }

  // ── 7. Excerpt — hard truncate to 180 chars at sentence or word boundary ──
  // Audit 2026-04-21 found 48% of EN excerpts >200 chars. Google SERP
  // shows ~155-160 of meta description; >200 means most readers see "...".
  // Aim for 180 max so we land in the 140-180 sweet spot.
  if (typeof article.excerpt === "string" && article.excerpt.length > 180) {
    let cut = article.excerpt.slice(0, 180);
    // Prefer cut at last sentence-end punctuation (. ! ?) within window
    const lastSentenceEnd = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("? "),
    );
    if (lastSentenceEnd > 100) {
      cut = cut.slice(0, lastSentenceEnd + 1);
    } else {
      // Fall back to word boundary, drop trailing partial word
      cut = cut.replace(/\s+\S*$/, "").trim();
      // Add ellipsis if we cut mid-thought
      if (!/[.!?]$/.test(cut)) cut += "…";
    }
    article.excerpt = cut;
  }

  // ── 8. Tags — fallback derive from title if empty ──────────────────────
  // Empty tags means: no JSON-LD keywords, no tag-page link flow, missing
  // related-articles signal. Audit 2026-04-21 caught the apt28 article
  // with empty tags — it shipped a year of zero hreflang signals.
  if (!Array.isArray(article.tags) || article.tags.length === 0) {
    article.tags = deriveTagsFromTitle(article.title);
  }

  return article;
}

/**
 * Derive 3-5 tags from a title when LLM didn't produce any. Lowercases,
 * filters stopwords, hyphenates multi-word phrases. Last-resort fallback —
 * not as good as LLM-chosen tags but better than empty (which breaks
 * tag-page rank flow entirely).
 */
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
  // Take up to 5 unique words, prefer earlier (more important) words
  return Array.from(new Set(words)).slice(0, 5);
}
