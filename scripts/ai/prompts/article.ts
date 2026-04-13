import type { Story } from "../../utils/dedup.js";

export function buildArticlePrompt(stories: Story[]): string {
  const sourceContext = stories
    .map(
      (s, i) =>
        `SOURCE ${i + 1}: "${s.title}" (from ${s.sourceName})\nURL: ${s.url}\n${s.excerpt}`,
    )
    .join("\n\n---\n\n");

  return `You are a senior cybersecurity analyst and technical writer for ZCyberNews.
Write at the level of Krebs on Security — accurate, technically precise, no marketing language.
Use inverted pyramid structure. Attribute claims to sources. Flag uncertainty explicitly.

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
- 800-1200 words total
- Use markdown (## headings, **bold** for key terms, \`code\` for CVE IDs/hashes/commands)
- Start Executive Summary with the most important finding
- References section: list all source URLs as markdown links
- If a section has no data (e.g. no IOCs), write "None identified at this time."

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "title": "SEO-friendly headline, max 80 chars",
  "slug": "lowercase-hyphenated-slug-no-date",
  "excerpt": "Specific 1-2 sentence summary stating WHO did WHAT to WHOM and the impact. Include CVE IDs, threat actor names, or affected products when available. No generic filler like 'a new threat has emerged'. Max 200 chars.",
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
