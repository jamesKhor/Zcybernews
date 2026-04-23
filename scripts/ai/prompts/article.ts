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

3. VENDOR-PR-SHAPED: The source is a vendor press release with no technical
   substance — product launch, funding round, executive hire, analyst-report
   teaser, partnership announcement, award, certification, or webinar invite.
   Telltale patterns: title starts with "\${Brand} Announces/Launches/Unveils/
   Introduces/Partners/Achieves/Joins/Names/Appoints/Acquires/Wins"; body
   predominantly markets a product or person rather than reporting an
   incident, vulnerability, malware sample, or technique. Use reason:
   "vendor-pr-shaped". EXCEPTION: if the press release references a specific
   CVE ID or a concrete technical disclosure, it is acceptable to cover.

4. SPECULATIVE-ONLY: The source material has no concrete facts — no CVE ID,
   no CVSS score, no named threat actor, no IOC (hash / IP / domain / file
   path), no named victim, no named vulnerable product version, no MITRE
   technique. It's entirely analyst commentary, opinion, or "may/could/might"
   prose. Our readers need specifics. Use reason: "speculative-only".

5. TOO-THIN: The combined source material (across all \${stories.length} sources)
   totals under ~400 characters of substantive prose after stripping headers,
   bylines, ads, and social-share boilerplate. There is not enough signal
   to write a meaningful article. Use reason: "too-thin".

6. CATEGORY-MISMATCH-UNRESOLVABLE: You would be forced to classify this story
   as category="vulnerabilities" but the sources contain ZERO real CVE IDs
   (only placeholder-shaped strings, vague mentions, or "CVE has not been
   assigned" phrasing). The vulnerabilities category is CVE-hard-gated at
   the fact-check stage — an article landing there without a real CVE ID
   will be rejected downstream. If and only if the story clearly fits
   "industry" (breach reporting), "tools" (new defensive capability), or
   "malware" (threat-family analysis) instead, DO NOT reject — write it
   under the correct category with cve_ids: []. Use reason "category-
   mismatch-unresolvable" ONLY when none of those categories fit either.
${recentBlock}
══════════════════════════════════════════
ARTICLE RULES (only if not rejected)
══════════════════════════════════════════

REQUIRED SECTIONS (always include — exact H2 headers in this order):
## Executive Summary
## Technical Analysis
## Mitigations & Recommendations
## References

CONDITIONAL SECTIONS (include ONLY when sources provide concrete data —
OMIT THE H2 HEADER ENTIRELY otherwise; never write a stub like
"None identified" because the renderer surfaces the dedicated fields
[IOCTable, MitreMatrix, threat_actor cards] from frontmatter when
populated, so an empty body section is pure visual noise):
## Indicators of Compromise           ← include only if you also populate
                                        the \`iocs\` JSON field. Body content
                                        should add context (campaign timing,
                                        infrastructure cluster notes) that
                                        the table can't convey alone.
## Tactics, Techniques & Procedures   ← include only if you also populate
                                        the \`ttp_matrix\` JSON field. Body
                                        content explains the sequencing /
                                        attribution rationale beyond the
                                        bare technique IDs.
## Threat Actor Context               ← include only when you have a named
                                        actor / family / group with concrete
                                        attribution detail. If \`threat_actor\`
                                        is null, omit the section.

Order, when conditional sections ARE included: Executive Summary →
Technical Analysis → IOCs → TTPs → Threat Actor Context → Mitigations
→ References. Skip any conditional section whose data isn't there.

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
  * If a CONDITIONAL section (IOCs, TTPs, Threat Actor Context) has no
    support in sources, OMIT the H2 header entirely. Do NOT write
    "None identified" stubs — they are visual noise that erodes
    reader trust. The frontmatter fields are the source of truth;
    the body section only exists to add context the structured field
    cannot.
  * For Mitigations specifically: if sources truly have nothing, write
    a single short paragraph explaining what defenders should monitor
    given the threat shape (not generic "patch immediately" boilerplate).
    Mitigations is a REQUIRED section — never omit; just keep it honest.
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
- If a CONDITIONAL section has no data, OMIT its H2 header entirely (see
  CONDITIONAL SECTIONS rule above). Do not emit "None identified" stubs.
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

CVE ID RULES (CRITICAL — rewrite after 2026-04-21 quality failure):
- ONLY include real, verified CVE IDs that appear in the source material
- NEVER invent, guess, or use placeholder CVE IDs like CVE-2026-xxxxx
- NEVER write hedging phrases like "CVE ID not yet assigned", "CVE ID not
  publicly disclosed", "awaiting CVE assignment", "lacking a public CVE",
  "CVE identifier is pending", "no CVE has been assigned", or any variant.
  These phrases shipped publicly for 6 articles — they make ZCyberNews look
  like it doesn't know what it's writing about. Security professionals
  read articles for specific CVEs; an article hedging about missing CVEs
  has no value to them.
- Leave the "cve_ids" JSON array EMPTY if no confirmed CVE IDs exist
- A wrong CVE ID is far worse than no CVE ID — when in doubt, omit it

WHAT TO DO WHEN SOURCES HAVE NO CVE ID:
Reframe the article. It's no longer a "specific vulnerability" piece —
it's one of these alternatives depending on the actual source content:
  • "patch advisory" — describe the update/patch Fortinet/Microsoft/etc
    released without framing it as a specific named flaw. Focus on WHAT
    was patched (products, versions, affected sectors) and WHO should
    apply it. Example: "Fortinet released critical patches for
    FortiSandbox and FortiAnalyzer on April 14" (no CVE implied).
  • "research commentary" — summarize the researcher's disclosure,
    remediation steps, and affected versions without inventing a CVE frame.
  • "industry/analysis" — recategorize away from \`vulnerabilities\` to
    \`industry\` or \`tools\`. The category enum matters for fact-check gating.
Never pretend an article is about a specific flaw if the flaw has no
identifier you can cite.

STRUCTURED FIELD HARD-GATE for category="vulnerabilities" (CRITICAL):
If category="vulnerabilities", then BOTH of the following must hold in the
final JSON:
  * cve_ids MUST be a non-empty array of real CVE IDs from the sources.
  * At least ONE of {cvss_score, iocs, ttp_matrix, threat_actor} must be
    populated — a "vulnerability" article with zero structured depth is
    indistinguishable from a blog post.
If you cannot satisfy BOTH, reclassify the article to "industry", "tools",
or "malware" AS APPROPRIATE rather than forcing it into "vulnerabilities".
Do NOT reject — reclassify. The fact-check stage will reject any
vulnerabilities-category article that fails this gate.

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
  "title": "Query-first headline. Lead with the most-searched term: CVE ID, KB number, named actor, named victim, or product name. **HARD LIMIT: 50-60 chars; NEVER exceed 70 chars** — Google SERP truncates at 60-65 and pipeline AUTO-TRUNCATES at 70 (you lose the end of your headline if you overshoot). Count carefully. No 'Month YYYY'. Weak verbs BANNED: bolsters, addresses, highlights, emerges, enables, impacts, constrains. Use STRONG verbs: breaches, leaks, exploits, patches, blocks, hijacks, steals, escalates.",
  "slug": "lowercase-hyphenated-slug-no-date",
  "excerpt": "**HARD LIMIT: 140-160 chars; NEVER exceed 180 chars** — Google SERP shows ~155-160 of meta description and pipeline AUTO-TRUNCATES at 180 (your closing point gets clipped if you overshoot). Count carefully. This is the meta description that sells the click. MUST start with the named actor OR named victim OR CVE/KB/product identifier — whichever a reader would type into Google. MUST include one concrete number (record count, CVE ID, CVSS, dollars, version, build). MUST name at least one specific stakeholder (company, sector, product version). BANNED phrases: 'addresses vulnerabilities', 'patch immediately', 'a new threat', 'multiple vulnerabilities', 'significant', 'robust', 'emerges'. GOOD EXAMPLE (high-CTR, 155 chars): 'ShinyHunters published data from 13.5 million McGraw Hill accounts — names, emails, institutional affiliations — stolen from a misconfigured Salesforce instance.' BAD EXAMPLE (reject, vague + over-length): 'Multiple vulnerabilities in Orthanc DICOM server enable DoS, info disclosure, and RCE attacks. Patch immediately.'",
  "tldr": "OPTIONAL — 1-2 sentences (max 280 chars), an in-page editorial summary that complements (NOT duplicates) the excerpt. The excerpt is for Google SERP and sells the click; the tldr is for skim-readers who already landed and want the bottom-line in 5 seconds. Lead with the OUTCOME / SO-WHAT (not the actor or product name — those are already in the title). Include the same anchor metadata (CVE ID, CVSS, victim count) but structured as a 'what defenders should know' sentence. EXAMPLE: 'A 9.8-CVSS RCE in Cohere AI Terrarium lets attackers escape JS sandboxes; affects all installations on shared infra. No patch yet — disable Terrarium or isolate at network layer.' Omit this field entirely (set to null) if the article is a brief incident report or industry update where Executive Summary already serves the role.",
  "category": "one of: threat-intel | vulnerabilities | malware | industry | tools | ai",
  "tags": ["tag1", "tag2", "tag3"],  // **REQUIRED: at least 3 tags; ideally 4-6.** Empty tags break tag-page rank flow + JSON-LD keywords.
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
