import { extractCVEs, type Story } from "../utils/dedup.js";
import { classifyTopicLane, type TopicLane } from "./search-demand.js";

export interface SeoBrief {
  primaryQueryTarget: string;
  searchIntent:
    | "breaking-news"
    | "patch-guidance"
    | "incident-impact"
    | "technical-analysis"
    | "explainer";
  titlePromise: string;
  metaPromise: string;
  articleType: string;
  requiredEntities: string[];
  internalLinkTargets: string[];
  targetHub: string | null;
  sitemapEligible: boolean;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function combined(stories: Story[]): string {
  return stories
    .map((story) => `${story.title} ${story.excerpt} ${story.tags.join(" ")}`)
    .join(" ");
}

function firstMatch(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[0] ?? null;
}

function targetForLane(lane: TopicLane): string | null {
  const map: Record<TopicLane, string | null> = {
    vulnerabilities: "active-cves",
    ransomware: "ransomware-groups",
    "apt-state-actors": "apt-state-actors",
    breaches: "data-breaches",
    malware: "malware-loaders",
    "ai-security": "ai-security",
    "defender-ops": "defender-operations",
    policy: "cyber-policy",
  };
  return map[lane];
}

export function buildSeoBrief(
  stories: Story[],
  options: { clusterKey?: string; lane?: TopicLane } = {},
): SeoBrief {
  const text = combined(stories);
  const cves = extractCVEs(text);
  const lane =
    options.lane ??
    classifyTopicLane({
      title: stories[0]?.title ?? "",
      excerpt: stories[0]?.excerpt ?? "",
      tags: stories.flatMap((story) => story.tags),
    });
  const kb = firstMatch(text, /\bKB\d{6,}\b/i);
  const actor = firstMatch(
    text,
    /\b(?:APT\d{1,3}|LockBit|BlackCat|Cl0p|Lazarus|ShinyHunters|Scattered Spider)\b/i,
  );
  const product = firstMatch(
    text,
    /\b(?:Microsoft Exchange|Windows|Chrome|GitHub|Cisco|Fortinet|Ivanti|Palo Alto|VMware|OpenAI)\b/i,
  );
  const primaryQueryTarget =
    cves[0] ??
    kb?.toUpperCase() ??
    actor ??
    product ??
    stories[0]?.title ??
    "cybersecurity update";
  const searchIntent =
    lane === "vulnerabilities"
      ? "patch-guidance"
      : lane === "breaches" || lane === "ransomware"
        ? "incident-impact"
        : lane === "apt-state-actors" || lane === "malware"
          ? "technical-analysis"
          : "breaking-news";
  const targetHub = targetForLane(lane);

  return {
    primaryQueryTarget,
    searchIntent,
    titlePromise: `Lead with ${primaryQueryTarget} and the concrete defender impact.`,
    metaPromise: `Start with ${primaryQueryTarget}, include one concrete fact, and avoid wire-copy phrasing.`,
    articleType: lane,
    requiredEntities: uniq([
      primaryQueryTarget,
      ...cves,
      actor ?? "",
      product ?? "",
    ]),
    internalLinkTargets: uniq([targetHub ?? "", lane, ...cves]),
    targetHub,
    sitemapEligible: true,
  };
}

export function formatSeoBriefForPrompt(brief: SeoBrief): string {
  return [
    "SEO BRIEF",
    `Primary query target: ${brief.primaryQueryTarget}`,
    `Search intent: ${brief.searchIntent}`,
    `Article type: ${brief.articleType}`,
    `Title promise: ${brief.titlePromise}`,
    `Meta promise: ${brief.metaPromise}`,
    `Target hub: ${brief.targetHub ?? "none"}`,
    `Internal link targets: ${brief.internalLinkTargets.join(", ") || "none"}`,
  ].join("\n");
}
