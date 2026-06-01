import {
  extractCVEs,
  meaningfulWords,
  shareSlugPrefix,
  titleSimilarity,
  type Story,
} from "../utils/dedup.js";
import { extractThreatActor } from "./post-process.js";

export interface StoryCluster<T extends Story = Story> {
  key: string;
  stories: T[];
  sources: string[];
  latestPublishedAt: string;
}

const DEFAULT_WINDOW_HOURS = 72;
const MAX_CLUSTER_SIZE = 3;
const RELATED_TITLE_THRESHOLD = 0.42;
const KB_RE = /\bKB\d{6,}\b/gi;

const ACTOR_INTEL_KEYWORDS = [
  "ransomware",
  "ransom",
  "extortion",
  "leak",
  "leaked",
  "breach",
  "breached",
  "stolen",
  "steals",
  "data theft",
  "dark web",
  "affiliate",
  "claims",
  "claimed",
  "campaign",
  "targets",
  "targeted",
  "exfiltrat",
];

const IMPACT_KEYWORDS = [
  "records",
  "customers",
  "users",
  "accounts",
  "patients",
  "employees",
  "students",
  "reservations",
  "credentials",
  "emails",
  "database",
];

const TRAFFIC_PULL_KEYWORDS = [
  "privilege escalation",
  "local privilege",
  "lpe",
  "remote code execution",
  "rce",
  "zero-day",
  "0-day",
  "actively exploited",
  "exploited",
  "exploit released",
  "proof-of-concept",
  "poc",
  "kernel",
  "linux",
  "sudo",
  "microsoft",
  "windows",
  "office",
  "exchange",
  "sharepoint",
  "android",
  "chrome",
  "github",
  "docker",
  "kubernetes",
];

const NAMED_INCIDENT_RE =
  /\b(?:badsuccessor|bad-successor|blast-radius|citrixbleed|dirty\s+pipe|eclipse|ingressnightmare|log4shell|nightmare|printnightmare|proxyshell|regresshion|spring4shell|storm|tool\s*shell|typhoon|zerologon)\b/i;

const DISCLOSURE_POLICY_TERMS = /\b(?:zero-day|0-day)\b/i;
const DISCLOSURE_CONTEXT_TERMS =
  /\b(?:release|releases|released|disclosure|researcher|researchers|backlash|justifiable|criticism|policy|drop more)\b/i;
const DISCLOSURE_ENTITY_TERMS = [
  "microsoft",
  "github",
  "google",
  "apple",
  "cisco",
  "fortinet",
  "palo alto",
  "ivanti",
  "mozilla",
  "linux",
];

function publishedTime(story: Story): number {
  const t = new Date(story.publishedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function withinWindow(a: Story, b: Story, windowHours: number): boolean {
  const diff = Math.abs(publishedTime(a) - publishedTime(b));
  return diff <= windowHours * 60 * 60 * 1000;
}

function sourceKey(story: Story): string {
  return story.sourceId ?? story.sourceName;
}

function extractKbIds(text: string): string[] {
  return [...new Set((text.match(KB_RE) ?? []).map((id) => id.toUpperCase()))];
}

function signatureFromWords(story: Story): string {
  const words = meaningfulWords(`${story.title} ${story.tags.join(" ")}`)
    .filter(
      (word) =>
        word.length >= 4 &&
        ![
          "security",
          "cybersecurity",
          "attack",
          "attacks",
          "critical",
          "vulnerability",
          "vulnerabilities",
          "malware",
        ].includes(word),
    )
    .slice(0, 5);
  return words.length >= 3
    ? words.join("-")
    : meaningfulWords(story.title).slice(0, 5).join("-");
}

export function storyClusterKey(story: Story): string {
  const text = `${story.title} ${story.excerpt} ${story.tags.join(" ")}`;
  const cves = extractCVEs(text);
  if (cves.length > 0) return `cve:${cves.sort().join("+")}`;

  const kbIds = extractKbIds(text);
  if (kbIds.length > 0) return `kb:${kbIds.sort().join("+")}`;

  return `topic:${signatureFromWords(story)}`;
}

function hasSharedStrongSignal(a: Story, b: Story): boolean {
  const aText = `${a.title} ${a.excerpt}`;
  const bText = `${b.title} ${b.excerpt}`;
  const aCves = extractCVEs(aText);
  const bCves = extractCVEs(bText);
  if (aCves.some((cve) => bCves.includes(cve))) return true;

  const aKbs = extractKbIds(aText);
  const bKbs = extractKbIds(bText);
  if (aKbs.some((kb) => bKbs.includes(kb))) return true;

  return false;
}

function disclosurePolicyEntities(text: string): string[] {
  const lower = text.toLowerCase();
  return DISCLOSURE_ENTITY_TERMS.filter((term) => lower.includes(term));
}

function shareDisclosurePolicyTopic(a: Story, b: Story): boolean {
  const aText = `${a.title} ${a.excerpt} ${a.tags.join(" ")}`;
  const bText = `${b.title} ${b.excerpt} ${b.tags.join(" ")}`;
  if (
    !DISCLOSURE_POLICY_TERMS.test(aText) ||
    !DISCLOSURE_POLICY_TERMS.test(bText) ||
    !DISCLOSURE_CONTEXT_TERMS.test(aText) ||
    !DISCLOSURE_CONTEXT_TERMS.test(bText)
  ) {
    return false;
  }

  const bEntities = new Set(disclosurePolicyEntities(bText));
  return disclosurePolicyEntities(aText).some((entity) =>
    bEntities.has(entity),
  );
}

function storiesBelongTogether(
  story: Story,
  cluster: StoryCluster,
  windowHours: number,
): boolean {
  return cluster.stories.some((existing) => {
    if (!withinWindow(story, existing, windowHours)) return false;
    if (storyClusterKey(story) === storyClusterKey(existing)) return true;
    if (hasSharedStrongSignal(story, existing)) return true;
    if (shareDisclosurePolicyTopic(story, existing)) return true;
    if (shareSlugPrefix(story.title, existing.title, 3)) return true;
    return (
      titleSimilarity(story.title, existing.title) >= RELATED_TITLE_THRESHOLD
    );
  });
}

function sortClusterStories<T extends Story>(stories: T[]): T[] {
  return [...stories].sort((a, b) => {
    const sourceDelta = sourceKey(a).localeCompare(sourceKey(b));
    if (sourceDelta === 0) {
      return publishedTime(b) - publishedTime(a);
    }
    return sourceDelta;
  });
}

function finalizeCluster<T extends Story>(
  cluster: StoryCluster<T>,
): StoryCluster<T> {
  const stories = sortClusterStories(cluster.stories).slice(
    0,
    MAX_CLUSTER_SIZE,
  );
  const sources = [...new Set(stories.map(sourceKey))];
  const latestPublishedAt =
    stories
      .map((s) => s.publishedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ??
    new Date(0).toISOString();

  return { ...cluster, stories, sources, latestPublishedAt };
}

function storyEditorialPriorityScore(story: Story): number {
  const text = `${story.title} ${story.excerpt} ${story.tags.join(" ")}`;
  const lower = text.toLowerCase();
  let score = 0;

  if (extractThreatActor(text)) score += 8;
  if (ACTOR_INTEL_KEYWORDS.some((word) => lower.includes(word))) score += 5;
  if (NAMED_INCIDENT_RE.test(text)) score += 6;
  if (TRAFFIC_PULL_KEYWORDS.some((word) => lower.includes(word))) score += 4;
  if (
    /(?:linux|kernel|sudo|windows|microsoft)/i.test(text) &&
    /(?:privilege escalation|local privilege|rce|remote code execution|exploit|vulnerability|flaw|bug|cve-\d{4}-\d{4,})/i.test(
      text,
    )
  ) {
    score += 4;
  }
  if (/\b\d[\d,.]*\s*(?:k|m|million|billion)?\b/i.test(text)) score += 2;
  if (IMPACT_KEYWORDS.some((word) => lower.includes(word))) score += 2;
  if (extractCVEs(text).length > 0) score += 3;
  if (
    ["threat-intel", "malware"].includes(story.sourceCategory ?? "") ||
    story.tags.some((tag) => ["threat-intel", "malware"].includes(tag))
  ) {
    score += 2;
  }

  return score;
}

export function clusterEditorialPriorityScore(
  cluster: StoryCluster<Story>,
): number {
  return Math.max(...cluster.stories.map(storyEditorialPriorityScore), 0);
}

export function clusterStories<T extends Story>(
  stories: T[],
  windowHours = DEFAULT_WINDOW_HOURS,
): StoryCluster<T>[] {
  const sorted = [...stories].sort(
    (a, b) => publishedTime(b) - publishedTime(a),
  );
  const clusters: StoryCluster<T>[] = [];

  for (const story of sorted) {
    const existing = clusters.find((cluster) =>
      storiesBelongTogether(story, cluster, windowHours),
    );

    if (existing) {
      existing.stories.push(story);
      continue;
    }

    clusters.push({
      key: storyClusterKey(story),
      stories: [story],
      sources: [sourceKey(story)],
      latestPublishedAt: story.publishedAt,
    });
  }

  return clusters.map(finalizeCluster).sort((a, b) => {
    const editorialDelta =
      clusterEditorialPriorityScore(b) - clusterEditorialPriorityScore(a);
    if (editorialDelta !== 0) return editorialDelta;
    const multiSourceDelta =
      Number(b.sources.length > 1) - Number(a.sources.length > 1);
    if (multiSourceDelta !== 0) return multiSourceDelta;
    const sizeDelta = b.stories.length - a.stories.length;
    if (sizeDelta !== 0) return sizeDelta;
    return (
      new Date(b.latestPublishedAt).getTime() -
      new Date(a.latestPublishedAt).getTime()
    );
  });
}
