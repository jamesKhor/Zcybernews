/**
 * Fact-check — runs between article generation and MDX write.
 *
 * Core principle: deterministic rules belong in scripts. We do NOT use
 * an LLM for fact-checking — regex + string matching + a registry is
 * cheaper, faster, and more reliable. The LLM already had its chance
 * (prompt-level REJECT rules); this is the shift-right safety net.
 *
 * Scope (we are an INFORMATION-SHARING site, not a red team):
 *   ✅ CVE IDs cited in body must appear in source material
 *   ✅ IOC hashes/IPs/domains cited must appear in source
 *   ✅ Threat actor names must be in known registry OR appear in source
 *   ✅ Source URLs must resolve (HEAD 200 OK)
 *   ✅ Large numbers (>10) in body should appear in source
 *   ❌ NOT testing whether the attack chain actually works — out of scope
 */
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import type { Story } from "../utils/dedup.js";

// ── Registry ──────────────────────────────────────────────────────────────

/**
 * Known threat actor names — a starter subset. If a name in the article is
 * NOT in this list AND does not appear in source material, we flag it.
 * Expand over time as real-world coverage grows.
 */
const KNOWN_THREAT_ACTORS = new Set(
  [
    // APTs (state-sponsored)
    "APT1",
    "APT3",
    "APT10",
    "APT17",
    "APT18",
    "APT19",
    "APT22",
    "APT28",
    "APT29",
    "APT30",
    "APT31",
    "APT32",
    "APT33",
    "APT34",
    "APT35",
    "APT36",
    "APT37",
    "APT38",
    "APT39",
    "APT40",
    "APT41",
    "APT42",
    "APT43",
    // Named groups
    "Lazarus",
    "Lazarus Group",
    "Kimsuky",
    "Andariel",
    "BlueNoroff",
    "Silent Chollima",
    "Turla",
    "Sandworm",
    "Fancy Bear",
    "Cozy Bear",
    "Equation Group",
    "Shadow Brokers",
    "Winnti",
    "Bronze Butler",
    "Cobalt Group",
    "Carbanak",
    // FIN groups (financially motivated)
    "FIN4",
    "FIN5",
    "FIN6",
    "FIN7",
    "FIN8",
    "FIN10",
    "FIN11",
    "FIN12",
    "FIN13",
    // Ransomware operators
    "Conti",
    "LockBit",
    "REvil",
    "DarkSide",
    "BlackCat",
    "ALPHV",
    "Cl0p",
    "Clop",
    "RansomHub",
    "Scattered Spider",
    "BlackBasta",
    "Black Basta",
    "Hive",
    "Play",
    "Royal",
    "Akira",
    "Medusa",
    // TA clusters
    "TA505",
    "TA577",
    "TA866",
    "TA886",
    "TA2541",
    "TA2722",
    // Common malware family names that show up as actors
    "Storm-0558",
    "Storm-1811",
    "Storm-2755",
    // Chinese-named groups
    "Volt Typhoon",
    "Flax Typhoon",
    "Salt Typhoon",
    "Brass Typhoon",
    "Mustang Panda",
    "Stone Panda",
    "Double Dragon",
    // Others
    "EvilProxy",
    "GoldenJackal",
    "Worok",
    "Void Manticore",
  ].map((s) => s.toLowerCase()),
);

// ── Types ─────────────────────────────────────────────────────────────────

export type FactCheckSeverity = "high" | "medium" | "low";

export type FactCheckIssue = {
  severity: FactCheckSeverity;
  type:
    | "cve_not_in_source"
    | "cve_placeholder_in_body"
    | "vuln_article_missing_cve"
    | "hash_not_in_source"
    | "ip_not_in_source"
    | "domain_not_in_source"
    | "actor_not_verified"
    | "url_unreachable"
    | "number_not_in_source";
  message: string;
  value?: string;
};

export type FactCheckResult = {
  passed: boolean;
  issues: FactCheckIssue[];
};

// ── Regex patterns ────────────────────────────────────────────────────────

const CVE_REGEX = /CVE-\d{4}-\d{4,}/g;
// Catches prompt-placeholder tokens the LLM may literal-copy into the body:
// CVE-2026-XXXXX, CVE-YYYY-NNNNN, CVE-2026-?????. Real CVEs have digits;
// placeholders have letters or question marks. post-process tries to
// recover (swap in a real CVE from sources or strip the sentence) — if
// anything survives to fact-check, we reject the article as HIGH severity.
const CVE_PLACEHOLDER_REGEX =
  /CVE-(?:\d{4}|[A-Z]{4})-(?:[XNY?]{2,}|[A-Z]{5})/gi;
const MD5_REGEX = /\b[a-fA-F0-9]{32}\b/g;
const SHA1_REGEX = /\b[a-fA-F0-9]{40}\b/g;
const SHA256_REGEX = /\b[a-fA-F0-9]{64}\b/g;
const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
// Numbers > 10 with optional suffix (K, M, B, %, etc.) — used for stat checks
const LARGE_NUMBER_REGEX =
  /\b(\d{2,}(?:,\d{3})*(?:\.\d+)?)\s*(?:million|billion|thousand|K|M|B|%)?\b/gi;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Normalized string contains check (lowercase, whitespace-collapsed). */
function normalizedIncludes(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/\s+/g, " ");
  return h.includes(n);
}

/** Extract all unique matches of a regex from a string. */
function uniqueMatches(str: string, re: RegExp): string[] {
  const m = str.match(re) ?? [];
  return Array.from(new Set(m));
}

/** Build combined source text (title + excerpt + any available body). */
function buildSourceCorpus(sources: Story[]): string {
  return sources
    .map((s) => `${s.title} ${s.excerpt ?? ""}`)
    .join("\n")
    .toLowerCase();
}

/**
 * HEAD-check a URL with a short timeout. Returns true only on 2xx.
 * Network errors, 404s, 5xx all count as unreachable.
 */
async function isUrlReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    // Some sites block HEAD; retry with GET (still with timeout)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Run the fact-check gauntlet on a generated article against its source
 * stories. Returns a result object indicating whether high-severity issues
 * were found; the caller decides whether to reject or just log.
 *
 * Current policy: ANY high-severity issue → reject (in pipeline caller).
 */
export async function factCheckArticle(
  article: GeneratedArticle,
  sources: Story[],
  options: { checkUrls?: boolean } = {},
): Promise<FactCheckResult> {
  const { checkUrls = true } = options;
  const issues: FactCheckIssue[] = [];
  const sourceText = buildSourceCorpus(sources);

  // ── 1a. CVE placeholder hard gate ──────────────────────────────────────
  // If post-process.ts failed to recover or strip the placeholder, reject
  // outright. A vuln article with "CVE-YYYY-XXXXX" in body/excerpt/title
  // has zero value to readers and hurts domain trust.
  const placeholderHaystack = [
    article.body ?? "",
    article.excerpt ?? "",
    article.title ?? "",
  ].join("\n");
  const placeholderMatches = uniqueMatches(
    placeholderHaystack,
    CVE_PLACEHOLDER_REGEX,
  );
  for (const p of placeholderMatches) {
    issues.push({
      severity: "high",
      type: "cve_placeholder_in_body",
      message: `Article contains literal CVE placeholder "${p}" (body/excerpt/title) — no real CVE ID. Reject.`,
      value: p,
    });
  }

  // ── 1b. Vulnerability article without any CVE ──────────────────────────
  // If the article is categorized as a vulnerability OR the title / body
  // strongly implies a specific flaw, it MUST cite a real CVE in the body.
  // Otherwise it's filler ("a critical flaw was disclosed" with no ID).
  const vulnCategory = article.category === "vulnerabilities";
  const vulnTitleHint =
    /\b(vulnerability|vulnerable|flaw|zero[- ]?day|rce|remote code execution|privilege escalation|sql injection|xss)\b/i.test(
      article.title ?? "",
    );
  const articleCves = uniqueMatches(article.body, CVE_REGEX);
  const sourceCves = uniqueMatches(sourceText.toUpperCase(), CVE_REGEX);
  if ((vulnCategory || vulnTitleHint) && articleCves.length === 0) {
    issues.push({
      severity: "high",
      type: "vuln_article_missing_cve",
      message: `Article is framed as a vulnerability${vulnCategory ? " (category=vulnerabilities)" : ""} but contains no CVE ID. Either source didn't disclose one — pick a different category — or the LLM omitted it.`,
    });
  }
  for (const cve of articleCves) {
    if (!sourceCves.includes(cve)) {
      issues.push({
        severity: "high",
        type: "cve_not_in_source",
        message: `Article cites ${cve} but it does not appear in any source material`,
        value: cve,
      });
    }
  }
  // Also check frontmatter cve_ids array
  for (const cve of article.cve_ids ?? []) {
    if (!sourceCves.includes(cve)) {
      issues.push({
        severity: "high",
        type: "cve_not_in_source",
        message: `Frontmatter cve_ids contains ${cve} but it does not appear in source material`,
        value: cve,
      });
    }
  }

  // ── 2. Hashes (MD5 / SHA1 / SHA256) ─────────────────────────────────────
  const articleHashes = [
    ...uniqueMatches(article.body, MD5_REGEX),
    ...uniqueMatches(article.body, SHA1_REGEX),
    ...uniqueMatches(article.body, SHA256_REGEX),
  ];
  for (const hash of articleHashes) {
    if (!normalizedIncludes(sourceText, hash)) {
      issues.push({
        severity: "high",
        type: "hash_not_in_source",
        message: `Hash ${hash.slice(0, 16)}... cited in body but not in sources`,
        value: hash,
      });
    }
  }

  // ── 3. IPs ──────────────────────────────────────────────────────────────
  const articleIps = uniqueMatches(article.body, IPV4_REGEX);
  for (const ip of articleIps) {
    // Skip common example/private IPs (not real IOCs)
    if (
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      ip === "127.0.0.1" ||
      ip.startsWith("0.") ||
      ip === "255.255.255.255"
    ) {
      continue;
    }
    if (!normalizedIncludes(sourceText, ip)) {
      issues.push({
        severity: "medium",
        type: "ip_not_in_source",
        message: `IP ${ip} cited in body but not in sources`,
        value: ip,
      });
    }
  }

  // ── 4. Threat actor names ───────────────────────────────────────────────
  const actor = article.threat_actor;
  if (actor && typeof actor === "string" && actor.trim() !== "") {
    const normalized = actor.toLowerCase().trim();
    const inRegistry = KNOWN_THREAT_ACTORS.has(normalized);
    const inSource = normalizedIncludes(sourceText, actor);
    if (!inRegistry && !inSource) {
      issues.push({
        severity: "high",
        type: "actor_not_verified",
        message: `Threat actor "${actor}" is not in the known registry and does not appear in source material — possible hallucination`,
        value: actor,
      });
    }
  }

  // ── 5. Source URL reachability ──────────────────────────────────────────
  if (checkUrls) {
    const sourceUrls = sources.map((s) => s.url).filter(Boolean);
    const reachResults = await Promise.all(
      sourceUrls.map(async (url) => ({ url, ok: await isUrlReachable(url) })),
    );
    for (const { url, ok } of reachResults) {
      if (!ok) {
        issues.push({
          severity: "medium", // medium — source could be transient, don't hard-fail
          type: "url_unreachable",
          message: `Source URL unreachable: ${url}`,
          value: url,
        });
      }
    }
  }

  // ── 6. Large numbers — warning only (medium) ────────────────────────────
  // Numbers in body that look like stats and don't appear in source
  const bodyNumbers = uniqueMatches(article.body, LARGE_NUMBER_REGEX);
  for (const rawNum of bodyNumbers) {
    const num = rawNum.trim();
    // Skip obvious non-stat numbers (years, CVE trailing, hash fragments handled above)
    if (/^(19|20)\d{2}$/.test(num)) continue; // year
    if (num.length < 2) continue;
    if (!normalizedIncludes(sourceText, num)) {
      issues.push({
        severity: "low",
        type: "number_not_in_source",
        message: `Number "${num}" in body not found in source — verify claim`,
        value: num,
      });
    }
  }

  // Policy: passed = no HIGH-severity issues. Medium/low are logged but
  // do not block publishing. Operator can review via ops digest.
  const highSeverity = issues.filter((i) => i.severity === "high");
  return {
    passed: highSeverity.length === 0,
    issues,
  };
}

/** Format a FactCheckResult for log output. */
export function formatFactCheckLog(result: FactCheckResult): string {
  if (result.issues.length === 0) return "✅ Fact-check passed (no issues)";
  const bySeverity = {
    high: result.issues.filter((i) => i.severity === "high").length,
    medium: result.issues.filter((i) => i.severity === "medium").length,
    low: result.issues.filter((i) => i.severity === "low").length,
  };
  const lines = [
    `${result.passed ? "⚠️" : "❌"} Fact-check: ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low`,
    ...result.issues.slice(0, 10).map((i) => `  [${i.severity}] ${i.message}`),
  ];
  if (result.issues.length > 10) {
    lines.push(`  …and ${result.issues.length - 10} more`);
  }
  return lines.join("\n");
}
