/**
 * Back-catalog quality audit (Eric's addition 2026-04-21).
 *
 * Scans EVERY published article (EN + ZH × posts + threat-intel) for the
 * full set of LLM-pollution patterns surfaced by Vincent + Raymond audits:
 *
 *  1. CVE hedging phrases (7 variants from fact-check.ts CVE_HEDGING_PATTERNS)
 *  2. CVE placeholder tokens (CVE-2026-XXXXX style)
 *  3. Generic LLM filler ("details unclear", "no specific information",
 *     "appears to be", "suggests that", "could potentially") — these are
 *     epistemic-uncertainty markers that imply the LLM didn't have facts
 *  4. Padding markers ("It is important to note", "It is worth mentioning",
 *     "In conclusion", "stay vigilant") — typical LLM filler when sources
 *     are too thin for the requested length
 *  5. Vuln-category articles with NO CVE in body (the broader version of
 *     today's audit-vuln-cves.ts finding — extended to all locales)
 *  6. ZH translation hedging (Chinese equivalents of "not yet assigned")
 *
 * Output: data/audit-backcatalog-2026-04-21.json — per-file findings ready
 * for operator review + decision (delete / rewrite / accept). Idempotent.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const ROOT = path.join(process.cwd(), "content");
const OUT_PATH = path.join(
  process.cwd(),
  "data",
  "audit-backcatalog-2026-04-21.json",
);

// English hedging — the 7 patterns from fact-check.ts plus Eric's expansions
const EN_HEDGING: { name: string; rx: RegExp; severity: "high" | "medium" }[] =
  [
    {
      name: "cve_not_yet_assigned",
      severity: "high",
      rx: /CVE\s*(?:ID|identifier|number)?s?\s+(?:is|was|are|have|has)?\s*not\s*yet\s*(?:been\s+)?(?:assigned|issued|published|allocated|disclosed)/i,
    },
    {
      name: "cve_awaiting_pending",
      severity: "high",
      rx: /CVE\s*(?:ID|identifier|number)?s?\s+(?:is|was|are)?\s*(?:awaiting|pending)\s+(?:assignment|issuance|publication|allocation|disclosure)/i,
    },
    {
      name: "no_cve_assigned",
      severity: "high",
      rx: /no\s+CVE\s+(?:ID|identifier|number)?s?\s*(?:has\s+been|was|is|have\s+been)?\s*(?:assigned|issued|published|allocated|disclosed|released)/i,
    },
    {
      name: "lacking_public_cve",
      severity: "high",
      rx: /lacking\s+a\s+(?:public\s+)?CVE/i,
    },
    {
      name: "without_cve",
      severity: "high",
      rx: /without\s+(?:an?\s+)?(?:official\s+|assigned\s+|public\s+)?CVE\s+(?:ID|identifier|number|assignment)/i,
    },
    {
      name: "cve_tbd",
      severity: "high",
      rx: /CVE\s*(?:ID|identifier)?\s*[:\-]?\s*(?:TBD|TBA|N\/A|Pending|Unknown)\b/i,
    },
    {
      name: "cve_not_publicly_disclosed",
      severity: "high",
      rx: /CVE\s*(?:ID|identifier|number)?s?\s+.{0,20}not\s+(?:publicly\s+)?disclosed/i,
    },
    // Eric's expansions — generic uncertainty markers that signal padding/hedging
    {
      name: "details_unclear",
      severity: "medium",
      rx: /\b(?:details|specifics|specifics?|particulars)\s+(?:are|remain|are still)?\s*(?:unclear|undisclosed|unknown|not\s+(?:available|known))\b/i,
    },
    {
      name: "no_specific_information",
      severity: "medium",
      rx: /\bno\s+specific\s+(?:information|details|technical\s+details)\b/i,
    },
    // Padding markers — common LLM filler when forced to over-write
    {
      name: "padding_important_note",
      severity: "medium",
      rx: /\bIt\s+is\s+(?:important|worth|crucial|essential)\s+to\s+(?:note|mention|highlight|emphasize|consider)\b/i,
    },
    {
      name: "padding_in_conclusion",
      severity: "medium",
      rx: /\b(?:In\s+conclusion|To\s+summari[sz]e|In\s+summary|Overall),?\s/i,
    },
    {
      name: "padding_stay_vigilant",
      severity: "medium",
      rx: /\b(?:stay\s+vigilant|remain\s+vigilant|exercise\s+caution|practice\s+good\s+(?:cyber\s+)?hygiene)\b/i,
    },
  ];

// Chinese hedging (rough equivalents — translated hedging from EN→ZH pipeline)
const ZH_HEDGING: { name: string; rx: RegExp; severity: "high" | "medium" }[] =
  [
    {
      name: "cve_not_yet_assigned_zh",
      severity: "high",
      rx: /CVE\s*(?:编号|ID|标识符)?(?:尚未|暂未|还未|未)(?:分配|公布|发布|披露|指派)/,
    },
    {
      name: "no_cve_assigned_zh",
      severity: "high",
      rx: /(?:目前|当前|尚)(?:没有|无)\s*(?:相关\s*)?CVE\s*(?:编号|ID)?(?:被)?(?:分配|公布)/,
    },
    {
      name: "details_unclear_zh",
      severity: "medium",
      rx: /(?:详细|具体)\s*(?:信息|情况|内容)\s*(?:尚未|暂未|不明|未知|未公布)/,
    },
  ];

// CVE placeholder regex (existing)
const CVE_PLACEHOLDER = /CVE-(?:\d{4}|[A-Z]{4})-(?:[XNY?]{2,}|[A-Z]{5})/i;
const CVE_REAL = /CVE-\d{4}-\d{4,}/g;

interface Finding {
  file: string;
  locale: "en" | "zh";
  type: "posts" | "threat-intel";
  category: string | undefined;
  issues: { name: string; severity: string; matched: string }[];
  has_cve_in_body: boolean;
  word_count: number;
}

function scanFile(
  filePath: string,
  locale: "en" | "zh",
  type: "posts" | "threat-intel",
): Finding {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: fm, content } = matter(raw);
  const findings: Finding["issues"] = [];

  // Combined haystack — body + excerpt + title
  const haystack = [
    content,
    String(fm.excerpt ?? ""),
    String(fm.title ?? ""),
  ].join("\n");

  // CVE placeholder
  const phMatch = haystack.match(CVE_PLACEHOLDER);
  if (phMatch)
    findings.push({
      name: "cve_placeholder",
      severity: "high",
      matched: phMatch[0],
    });

  // English hedging (run on all — picks up English phrases that survived in ZH locales)
  for (const p of EN_HEDGING) {
    const m = haystack.match(p.rx);
    if (m)
      findings.push({
        name: p.name,
        severity: p.severity,
        matched: m[0].slice(0, 80),
      });
  }

  // Chinese hedging — only on ZH locale
  if (locale === "zh") {
    for (const p of ZH_HEDGING) {
      const m = haystack.match(p.rx);
      if (m)
        findings.push({
          name: p.name,
          severity: p.severity,
          matched: m[0].slice(0, 80),
        });
    }
  }

  // Vuln-category articles with no real CVE in body
  const realCves = (content.match(CVE_REAL) ?? []).filter(
    (c) => !CVE_PLACEHOLDER.test(c),
  );
  const hasCveInBody = realCves.length > 0;
  if (fm.category === "vulnerabilities" && !hasCveInBody) {
    findings.push({
      name: "vuln_category_no_cve",
      severity: "high",
      matched: "(no CVE in body)",
    });
  }

  // Word count
  const wordCount =
    locale === "zh"
      ? (content.match(/[\u4e00-\u9fff]/g) ?? []).length // CJK char count for ZH
      : content.split(/\s+/).filter(Boolean).length; // word count for EN

  return {
    file: path.relative(ROOT, filePath),
    locale,
    type,
    category: fm.category as string | undefined,
    issues: findings,
    has_cve_in_body: hasCveInBody,
    word_count: wordCount,
  };
}

function walk() {
  const all: Finding[] = [];
  for (const locale of ["en", "zh"] as const) {
    for (const type of ["posts", "threat-intel"] as const) {
      const dir = path.join(ROOT, locale, type);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
        all.push(scanFile(path.join(dir, f), locale, type));
      }
    }
  }
  return all;
}

function summarize(findings: Finding[]) {
  const total = findings.length;
  const withIssues = findings.filter((f) => f.issues.length > 0);
  const high = findings.filter((f) =>
    f.issues.some((i) => i.severity === "high"),
  );
  const medium = findings.filter(
    (f) =>
      f.issues.some((i) => i.severity === "medium") &&
      !f.issues.some((i) => i.severity === "high"),
  );

  console.log(`\n=== Back-catalog audit (2026-04-21) ===`);
  console.log(`Total articles scanned: ${total}`);
  console.log(`  • Clean: ${total - withIssues.length}`);
  console.log(
    `  • HIGH severity issues: ${high.length} (${Math.round((100 * high.length) / total)}%)`,
  );
  console.log(
    `  • MEDIUM only: ${medium.length} (${Math.round((100 * medium.length) / total)}%)`,
  );

  // Aggregate by issue type
  const byIssue = new Map<string, number>();
  for (const f of findings) {
    for (const i of f.issues)
      byIssue.set(i.name, (byIssue.get(i.name) ?? 0) + 1);
  }
  console.log(`\n── Issue distribution ───────────────────`);
  for (const [name, count] of [...byIssue.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${name.padEnd(35)} ${count}`);
  }

  // Top 10 worst offenders
  const ranked = [...withIssues]
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 15);
  console.log(`\n── Top 15 worst offenders ───────────────`);
  for (const f of ranked) {
    console.log(`  [${f.issues.length} issues] ${f.file}`);
    for (const i of f.issues.slice(0, 3))
      console.log(`     [${i.severity}] ${i.name}: "${i.matched}"`);
  }

  // Save full report
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_scanned: total,
        high_severity_count: high.length,
        medium_only_count: medium.length,
        findings: withIssues,
      },
      null,
      2,
    ),
  );
  console.log(`\nFull report: ${path.relative(process.cwd(), OUT_PATH)}`);
}

const all = walk();
summarize(all);
