/**
 * Sparse-sheet deterministic templates.
 *
 * When a fact sheet has too little concrete data (no actors + no CVEs + few
 * sectors/regions), the LLM falls back to its training set and invents
 * specifics (e.g. hallucinates "CVE-2026-12345" or "APT28"). Fact-check
 * catches this, but the retry cycle is wasted money and the tag ends up
 * with no intro.
 *
 * For those tags we write a deterministic template instead — pure script,
 * zero LLM. Matches the operator's rule: deterministic belongs in scripts.
 */
import type { TagFactSheet } from "./types.js";

const SPARSE_DENSITY_THRESHOLD = 3;

export function sheetDensity(sheet: TagFactSheet): number {
  return (
    (sheet.top_actors?.length ?? 0) +
    (sheet.top_cves?.length ?? 0) +
    (sheet.top_sectors?.length ?? 0) +
    (sheet.top_regions?.length ?? 0)
  );
}

export function isSparse(sheet: TagFactSheet): boolean {
  // Primary rule: total density < 3 fields
  if (sheetDensity(sheet) < SPARSE_DENSITY_THRESHOLD) return true;
  // Secondary rule: zero actors AND zero CVEs — the two fields that give
  // intros concrete specifics. Without both, the LLM can only write about
  // sectors/regions, runs short (<60 words), and is tempted to invent.
  if (
    (sheet.top_actors?.length ?? 0) === 0 &&
    (sheet.top_cves?.length ?? 0) === 0
  )
    return true;
  return false;
}

function formatDateEn(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateZh(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

const SEV_ORDER = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;

function severityPhraseEn(mix: Record<string, number>): string {
  const parts: string[] = [];
  for (const k of SEV_ORDER) {
    const n = mix[k];
    if (n && n > 0) parts.push(`${n} ${k}`);
  }
  if (parts.length === 0) return "";
  const noun =
    parts.length === 1 && /^1 /.test(parts[0]) ? "report" : "reports";
  if (parts.length === 1) return `${parts[0]} ${noun}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]} ${noun}`;
}

function severityPhraseZh(mix: Record<string, number>): string {
  const map: Record<string, string> = {
    critical: "严重",
    high: "高危",
    medium: "中危",
    low: "低危",
    informational: "信息类",
  };
  const parts: string[] = [];
  for (const k of SEV_ORDER) {
    const n = mix[k];
    if (n && n > 0) parts.push(`${n} 篇${map[k]}`);
  }
  return parts.join("、");
}

export function buildSparseIntroEn(sheet: TagFactSheet): string {
  const { tag, count, date_range, severity_mix } = sheet;
  const first = formatDateEn(date_range.first);
  const latest = formatDateEn(date_range.latest);
  const sev = severityPhraseEn(severity_mix ?? {});
  const dateSentence =
    first === latest
      ? `This archive collects ${count} articles tagged \`${tag}\` published on ${latest}.`
      : `This archive collects ${count} articles tagged \`${tag}\` published between ${first} and ${latest}.`;
  const sevSentence = sev ? `Coverage includes ${sev}.` : "";
  const closingSentence =
    "Individual reports below detail the specific incidents, affected systems, and recommended mitigations for security teams tracking this topic.";
  return [dateSentence, sevSentence, closingSentence].filter(Boolean).join(" ");
}

export function buildSparseIntroZh(sheet: TagFactSheet): string {
  const { tag, count, date_range, severity_mix } = sheet;
  const first = formatDateZh(date_range.first);
  const latest = formatDateZh(date_range.latest);
  const sev = severityPhraseZh(severity_mix ?? {});
  const dateSentence =
    first === latest
      ? `本档案收录了 ${count} 篇带有「${tag}」标签的文章，发布于${latest}。`
      : `本档案收录了 ${count} 篇带有「${tag}」标签的文章，发布时间从${first}至${latest}。`;
  const sevSentence = sev ? `其中包含${sev}报告。` : "";
  const closingSentence =
    "下方各条报道详细介绍了具体事件、受影响系统以及对安全团队的缓解建议。";
  return dateSentence + sevSentence + closingSentence;
}
