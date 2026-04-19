import type { Story } from "../../utils/dedup.js";

export interface BuildArticlePromptOptions {
  /**
   * Target word range injected into WRITING RULES. Adaptive per
   * source richness (see scripts/pipeline/generate-article.ts →
   * classifySourceRichness). Examples: "800-1200 words", "1500-2200
   * words", "2000-3000 words". Defaults to 1500-2200 which matches
   * the majority-case "long" tier.
   */
  targetRange?: string;
}

export function buildArticlePrompt(
  stories: Story[],
  recentTitles: string[] = [],
  options: BuildArticlePromptOptions = {},
): string {
  const targetRange = options.targetRange ?? "1500-2200 words";
  const sourceContext = stories
    .map(
      (s, i) =>
        `SOURCE ${i + 1}: "${s.title}" (from ${s.sourceName})\nURL: ${s.url}\n${s.excerpt}`,
    )
    .join("\n\n---\n\n");

  const recentBlock =
    recentTitles.length > 0
      ? `\nRECENTLY PUBLISHED (last 48h — do NOT cover the same story again):\n${recentTitles.map((t) => `- ${t}`).join("\n")}\n`
      : "";

  return `You are a senior cybersecurity analyst and technical writer for ZCyberNews.
Write at the level of Krebs on Security — accurate, technically precise, no marketing language.
Use inverted pyramid structure. Attribute claims to sources. Flag uncertainty explicitly.

TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}

══════════════════════════════════════════
REJECT RULES — check these FIRST
══════════════════════════════════════════

If ANY of the following apply, respond with ONLY this JSON and nothing else:
{"reject": true, "reason": "<one of the reasons below>"}

1. OFF-TOPIC: The source material is NOT about cybersecurity, information security,
   network security, or technology security. Examples that must be rejected:
   renewable energy, climate, fishing, sports, general politics, cooking, travel.
   If in doubt: ask "would this appear on BleepingComputer or Krebs on Security?"
   If no → reject.

2. ALREADY COVERED: The story is substantially the same as one of the recently
   published articles listed below (same CVE batch, same threat actor operation,
   same product feature announcement, same law enforcement action). Different angle
   on the exact same event = reject. Use reason: "already covered: <matching title>"
${recentBlock}
══════════════════════════════════════════
ARTICLE RULES (only if not rejected)
══════════════════════════════════════════

REQUIRED SECTIONS (exact H2 headers in this order):
## Executive Summary
## Technical Analysis
## Indicators of Compromise
## Tactics, Techniques & Procedures
## Threat Actor Context
## Mitigations & Recommendations
## References

WRITING RULES:
- Do NOT copy sentences verbatim — rewrite entirely in your own words
- Target length: ${targetRange} total. This target is calibrated to the
  amount of source material provided below. DO NOT pad to hit the
  upper bound if the source material does not genuinely support that
  depth — a tight 1200-word article is better than a bloated 2000-word
  one with filler.
- ANTI-FILLER RULES (CRITICAL — quality gate):
  * Every paragraph must add a NEW fact, analysis, or technical detail
    attributable to the source material. No restating the same point
    in different words.
  * If a required section (IOCs, TTPs, Mitigations) has no support in
    sources, write exactly "None identified in source material." Do
    NOT invent generic best-practices to fill it.
  * Do NOT speculate. Do NOT add phrases like "could potentially",
    "might theoretically", "in some cases", "it is believed that"
    unless the source uses exactly that hedging for a specific claim.
  * Do NOT add marketing-style closers: "organizations must stay
    vigilant", "cybersecurity is a shared responsibility", "as threats
    evolve". These are filler. End the article with the References
    section, not a wrap-up paragraph.
  * If total source material is thin and you cannot meet the lower
    bound of the target range without padding, it is ACCEPTABLE to
    write a shorter honest article. The target is a ceiling discipline,
    not a floor obligation.
- Use markdown (## headings, **bold** for key terms, \`code\` for CVE IDs/hashes/commands)
- Start Executive Summary with the most important finding
- References section: list all source URLs as markdown links
- If a section has no data (e.g. no IOCs), write "None identified at this time."
- Article body MUST be written entirely in English. No Chinese, Arabic, or any
  other language characters anywhere in the body or frontmatter fields.
- The "excerpt" field becomes the Google SERP meta description that sells the
  click. If it would fit on a wire-service summary unchanged, it is wrong —
  wire summaries do not need to convert clicks. See OUTPUT FORMAT below for
  specific excerpt rules.

TITLE RULES (CRITICAL — hallucinated dates have caused production issues):
- Write titles in present-tense news style: "Microsoft Patches SharePoint Zero-Day"
- NEVER include a specific past month+year in the title (e.g. "May 2025 Patch Tuesday",
  "July 2026 Updates", "March 2026 Roundup"). These are hallucinated historical framings.
- Exception: only use a month+year if it refers to a FUTURE scheduled event explicitly
  named in the source (e.g. "Microsoft's Upcoming June 2026 Patch Tuesday").
- If sources give conflicting numbers for the same event (e.g. "247 flaws" vs "167 flaws"
  for the same Patch Tuesday), use the highest-credibility source's number and note
  the discrepancy in the body. Do NOT generate separate articles for the same event.

CVE ID RULES (CRITICAL):
- ONLY include real, verified CVE IDs that appear in the source material
- NEVER invent, guess, or use placeholder CVE IDs like CVE-2026-xxxxx
- If the source mentions a vulnerability but does NOT provide a CVE ID, write
  "CVE ID not yet assigned" or "CVE ID not publicly disclosed" in the text
- Leave the "cve_ids" JSON array EMPTY if no confirmed CVE IDs exist in the sources
- A wrong CVE ID is far worse than no CVE ID — when in doubt, omit it

STRUCTURED FIELD EXTRACTION RULES (CRITICAL — the homepage relies on these):
Before writing the body prose, SCAN the sources for these fields and populate the
corresponding JSON fields whenever the sources contain them:

- "cvss_score": number 0.0-10.0. Look for "CVSS 9.8", "CVSSv3.1: 9.8", "base
  score of 9.8", "severity 9.8". If multiple candidates, use the highest from a
  credible source. If genuinely absent from sources, leave as null.
- "cve_ids": list every CVE ID that appears in sources (format CVE-YYYY-NNNNN).
  Do not invent — but DO include every real one. A vuln article without cve_ids
  should be rare.
- "threat_actor": canonical name of the group/actor/malware family. Examples:
  "LockBit", "BlackCat", "APT29", "Cozy Bear", "Scattered Spider", "Lazarus",
  "Lumma Stealer", "Mirai". For ransomware articles, always name the group if
  sources do. For malware articles, name the family. Null only if truly unknown.
- "affected_sectors": e.g. ["healthcare", "financial services", "government"].
  If the article describes a specific incident, list the victim's sector(s).
- "affected_regions": e.g. ["North America", "EU", "Netherlands"]. Name the
  country or broad region named by sources.

Think of these fields as a scorecard for your article's research quality.
An article with 4 of 5 filled is stronger than 1 of 5. Populate everything
sources support — don't play it safe by leaving fields null when evidence exists.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "title": "Query-first headline. Lead with the most-searched term: CVE ID, KB number, named actor, named victim, or product name. 50-60 chars. No 'Month YYYY'. Weak verbs BANNED: bolsters, addresses, highlights, emerges, enables, impacts, constrains. Use STRONG verbs: breaches, leaks, exploits, patches, blocks, hijacks, steals, escalates.",
  "slug": "lowercase-hyphenated-slug-no-date",
  "excerpt": "140-155 chars. This is the Google SERP meta description that sells the click. MUST start with the named actor OR named victim OR CVE/KB/product identifier — whichever a reader would type into Google. MUST include one concrete number (record count, CVE ID, CVSS, dollars, version, build). MUST name at least one specific stakeholder (company, sector, product version). BANNED phrases: 'addresses vulnerabilities', 'patch immediately', 'a new threat', 'multiple vulnerabilities', 'significant', 'robust', 'emerges'. GOOD EXAMPLE (high-CTR): 'ShinyHunters published data from 13.5 million McGraw Hill accounts — names, emails, institutional affiliations — stolen from a misconfigured Salesforce instance.' BAD EXAMPLE (reject): 'Multiple vulnerabilities in Orthanc DICOM server enable DoS, info disclosure, and RCE attacks. Patch immediately.'",
  "category": "one of: threat-intel | vulnerabilities | malware | industry | tools | ai",
  "tags": ["tag1", "tag2"],
  "severity": "one of: critical | high | medium | low | informational | null",
  "cvss_score": null,
  "cve_ids": [],
  "threat_actor": null,
  "threat_actor_origin": null,
  "affected_sectors": [],
  "affected_regions": [],
  "iocs": [],
  "ttp_matrix": [],
  "body": "full markdown article body (all 7 sections)"
}

SOURCES:
${sourceContext}

Respond with ONLY the JSON object. No explanation before or after.`;
}

export function buildTitlePrompt(body: string): string {
  return `Write a concise, SEO-friendly news headline (max 80 characters) for this cybersecurity article. Return ONLY the headline — no quotes, no explanation.\n\n${body.slice(0, 600)}`;
}
