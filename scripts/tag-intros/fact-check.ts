/**
 * P6 (inline) — Fact-check a generated tag intro against its fact sheet.
 *
 * Regex-extracts CVE IDs and actor mentions from the intro and verifies each
 * appears in the sheet. Also guards against trivial filler phrases and out-of-range
 * word counts. Deterministic — no LLM.
 */
import type { TagFactSheet } from "./types.js";

const CVE_REGEX = /CVE-\d{4}-\d{4,}/gi;
const BANNED_PHRASES = [
  "emerging threat",
  "growing concern",
  "stay tuned",
  "read more",
  "in conclusion",
  "unprecedented",
  "devastating",
];

export interface TagIntroCheckIssue {
  type:
    | "cve_not_in_sheet"
    | "actor_not_in_sheet"
    | "word_count_out_of_range"
    | "banned_phrase"
    | "empty_output";
  message: string;
  value?: string;
}

export interface TagIntroCheckResult {
  passed: boolean;
  issues: TagIntroCheckIssue[];
  wordCount: number;
}

export function wordCount(text: string): number {
  // Treat CJK characters as 1 "word" each; split latin on whitespace
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinWords = text
    .replace(/[\u4e00-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latinWords;
}

export function checkTagIntro(
  intro: string,
  sheet: TagFactSheet,
  options: { locale: "en" | "zh" } = { locale: "en" },
): TagIntroCheckResult {
  const issues: TagIntroCheckIssue[] = [];
  const text = intro.trim();

  if (!text) {
    return {
      passed: false,
      wordCount: 0,
      issues: [{ type: "empty_output", message: "LLM returned empty text" }],
    };
  }

  const wc = wordCount(text);
  // EN floor 60 (was 70): DeepSeek naturally produces 55-80 word intros; forced
  // retries to hit 70 cost tokens without SEO benefit — Helpful Content cares
  // about differentiation, not word count. ZH floor 100 (was 120) for the same
  // reason: Chinese is denser per character.
  const [min, max] = options.locale === "zh" ? [100, 240] : [60, 140];
  if (wc < min || wc > max) {
    issues.push({
      type: "word_count_out_of_range",
      message: `word count ${wc} outside ${min}-${max} (${options.locale})`,
    });
  }

  // CVE cross-check
  const sheetCves = new Set(sheet.top_cves.map((c) => c.id.toUpperCase()));
  const introCves = Array.from(
    new Set((text.match(CVE_REGEX) ?? []).map((s) => s.toUpperCase())),
  );
  for (const cve of introCves) {
    if (!sheetCves.has(cve)) {
      issues.push({
        type: "cve_not_in_sheet",
        message: `Intro cites ${cve} but it is not in the fact sheet`,
        value: cve,
      });
    }
  }

  // Actor cross-check — we look for any capitalized multi-word token in intro
  // that LOOKS like an actor name (e.g. "LockBit", "BlackCat", "APT28") and
  // require it to appear in sheet.top_actors. False-positive-friendly: we only
  // flag tokens that are already in a curated list of "looks like actor" patterns.
  const sheetActors = new Set(sheet.top_actors.map((a) => a.toLowerCase()));
  const ACTOR_LIKE =
    /\b(?:APT\d{1,3}|FIN\d{1,2}|TA\d{3,4}|[A-Z][a-z]+(?:Bit|Cat|Bear|Panda|Typhoon|Spider|Basta|Proxy))\b/g;
  const candidates = Array.from(new Set(text.match(ACTOR_LIKE) ?? []));
  for (const cand of candidates) {
    if (!sheetActors.has(cand.toLowerCase())) {
      // Allow if it appears as a substring of any sheet actor (e.g. "LockBit" in "LockBit 4.0")
      const inSubstring = sheet.top_actors.some((a) =>
        a.toLowerCase().includes(cand.toLowerCase()),
      );
      if (!inSubstring) {
        issues.push({
          type: "actor_not_in_sheet",
          message: `Intro mentions "${cand}" but it is not in the sheet's top_actors`,
          value: cand,
        });
      }
    }
  }

  // Banned filler phrases (EN only — ZH translation can keep proper nouns)
  if (options.locale === "en") {
    const lower = text.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) {
        issues.push({
          type: "banned_phrase",
          message: `Intro contains banned phrase: "${phrase}"`,
          value: phrase,
        });
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    wordCount: wc,
  };
}

export function formatCheckLog(result: TagIntroCheckResult): string {
  if (result.passed) return `✅ check passed (${result.wordCount} words)`;
  return [
    `❌ check FAILED (${result.wordCount} words, ${result.issues.length} issues)`,
    ...result.issues.map((i) => `  [${i.type}] ${i.message}`),
  ].join("\n");
}
