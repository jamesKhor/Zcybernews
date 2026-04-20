/**
 * Tag intro prompts — Prompt Engineer v1 (2026-04-20)
 *
 * Purpose: turn a structured fact sheet into an 80–120 word editorial intro
 * rendered above the tag page article grid. The LLM writes prose; ALL facts
 * come from the pre-aggregated sheet produced by aggregate-facts.ts.
 *
 * Hard rules (enforced by prompt + post-process fact-check):
 *   1. Use ONLY facts in the sheet. No outside knowledge.
 *   2. Never invent CVE IDs, actor names, sector names, counts.
 *   3. 80–120 words, third person, no CTAs, no "read more", no filler.
 *   4. No unsupported superlatives ("massive", "unprecedented", etc.).
 *   5. No list markdown — flowing prose only.
 *
 * Anti-template hints: three rotating lead-ins keyed by tag hash so identical
 * tags always produce the same lead pattern but the corpus isn't monotone.
 */
import type { TagFactSheet } from "../../tag-intros/types.js";

export const TAG_INTRO_PROMPT_VERSION = "v1.1.0-2026-04-20";

const LEAD_PATTERNS = [
  "Lead with the article count and date range.",
  "Lead with the most-covered threat actor or CVE.",
  "Lead with the dominant sector or region impacted.",
] as const;

function hashTag(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function buildTagIntroPrompt(sheet: TagFactSheet): string {
  const leadHint = LEAD_PATTERNS[hashTag(sheet.tag) % LEAD_PATTERNS.length];

  const factLines: string[] = [
    `TAG: ${sheet.tag}`,
    `ARTICLE COUNT: ${sheet.count}`,
    `DATE RANGE: ${sheet.date_range.first} to ${sheet.date_range.latest}`,
  ];
  if (sheet.top_actors.length)
    factLines.push(
      `TOP THREAT ACTORS (exact spelling required): ${sheet.top_actors.join(", ")}`,
    );
  if (sheet.top_cves.length)
    factLines.push(
      `TOP CVEs (exact IDs required): ${sheet.top_cves.map((c) => `${c.id}${c.cvss ? ` (CVSS ${c.cvss})` : ""}`).join(", ")}`,
    );
  if (sheet.top_sectors.length)
    factLines.push(`TOP AFFECTED SECTORS: ${sheet.top_sectors.join(", ")}`);
  if (sheet.top_regions.length)
    factLines.push(`TOP AFFECTED REGIONS: ${sheet.top_regions.join(", ")}`);
  const sevParts = Object.entries(sheet.severity_mix)
    .filter(([, n]) => n > 0)
    .map(([sev, n]) => `${n} ${sev}`);
  if (sevParts.length) factLines.push(`SEVERITY MIX: ${sevParts.join(", ")}`);

  return `You are an editor at ZCyberNews writing a short standfirst for a tag archive page.

══════════════════════════════════════════
FACT SHEET (your ONLY source of truth)
══════════════════════════════════════════
${factLines.join("\n")}

══════════════════════════════════════════
HARD RULES
══════════════════════════════════════════
1. Use ONLY the facts above. Do NOT add general knowledge, context, or analysis from outside the sheet.
2. Do NOT invent or alter CVE IDs, threat actor names, sectors, regions, or counts.
3. Write 80–120 words. Count carefully.
4. Third person. Flowing prose. No bullet lists. No headings. No CTAs. No "read more" / "stay tuned" / "emerging threat".
5. No superlatives ("massive", "devastating", "unprecedented", "alarming") unless that exact word is in the sheet.
6. ${leadHint}
7. Name specific actors and CVEs when the sheet provides them. Spell them exactly as written above.
8. Each actor in the TOP THREAT ACTORS list is a DISTINCT entity. Never describe one actor using another. Never place two actors in apposition (e.g. "Lazarus Group, a Russian-speaking threat actor"). Never imply aliases, affiliations, origins, or relationships between actors — the sheet does not assert these. List actors as separate subjects or in a simple conjunction ("X, Y, and Z were observed").
9. Do NOT assign a nationality, origin, or language to any actor unless the sheet explicitly pairs that attribute with that actor.
10. Do NOT wrap output in quotes, markdown, or code fences. Plain prose only.

Write the intro now. Output ONLY the prose paragraph, nothing else.`;
}

export function buildTagIntroTranslatePrompt(
  enIntro: string,
  sheet: TagFactSheet,
): string {
  const preserveTokens = [
    ...sheet.top_actors,
    ...sheet.top_cves.map((c) => c.id),
  ];
  const preserveBlock = preserveTokens.length
    ? `\n\nPRESERVE VERBATIM (do NOT translate or transliterate these tokens — copy them byte-for-byte):\n${preserveTokens.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `Translate the following English cybersecurity editorial intro into Simplified Chinese (zh-CN).

RULES:
1. Preserve all CVE IDs exactly (e.g. CVE-2026-12345 stays as CVE-2026-12345).
2. Preserve all threat actor names in English (e.g. LockBit, BlackCat, APT28 remain unchanged).
3. Keep the tone factual and neutral. No added analysis.
4. Output ONLY the translated paragraph. No quotes, no markdown, no preface.${preserveBlock}

ENGLISH SOURCE:
${enIntro}`;
}
