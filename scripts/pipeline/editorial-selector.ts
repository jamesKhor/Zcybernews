import type { Story } from "../utils/dedup.js";
import { buildEvidencePacket } from "./evidence-packet.js";
import {
  classifyTopicLane,
  scoreSearchDemand,
  type TopicLane,
} from "./search-demand.js";
import { scoreSourceTrust } from "./source-trust.js";
import type { StoryCluster } from "./story-clustering.js";
import type { EditorialTasteProfile, TastePattern } from "./taste-profile.js";
import type {
  NegativeTasteSignal,
  PositiveTasteSignal,
} from "./review-queue.js";

export type PublishDecision =
  | "publish-now"
  | "research-more"
  | "digest-only"
  | "reject";

export interface EditorialSelection {
  clusterKey: string;
  decision: PublishDecision;
  score: number;
  lane: TopicLane;
  reasons: string[];
  evidenceScore: number;
  trustScore: number;
  demandScore: number;
  freshnessScore: number;
  differentiationScore: number;
  portfolioScore: number;
  tasteProfileScore: number;
  tasteProfileReasons: string[];
}

export interface EditorialSelectorResult<T extends Story = Story> {
  publishable: Array<{
    clusterKey: string;
    cluster: StoryCluster<T>;
    selection: EditorialSelection;
  }>;
  decisions: EditorialSelection[];
}

const CVE_STYLE_DAILY_CAP_REASON = "cve-style daily cap";
const ARTICLE_DAILY_LIMIT_REASON = "daily article limit";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function newestAgeHours(cluster: StoryCluster<Story>): number {
  const latest = new Date(cluster.latestPublishedAt).getTime();
  if (!Number.isFinite(latest)) return 999;
  return Math.max(0, (Date.now() - latest) / (60 * 60 * 1000));
}

function freshnessScore(cluster: StoryCluster<Story>): number {
  const age = newestAgeHours(cluster);
  if (age <= 12) return 1;
  if (age <= 48) return 0.82;
  if (age <= 96) return 0.62;
  if (age <= 24 * 14) return 0.34;
  return 0.08;
}

function evidenceScore(packet: ReturnType<typeof buildEvidencePacket>): number {
  let score = 0.12;
  score += Math.min(0.25, packet.sourceCount * 0.12);
  if (packet.hasPrimaryEvidence) score += 0.18;
  score += Math.min(0.22, packet.entities.cves.length * 0.08);
  score += Math.min(0.12, packet.facts.cvssScores.length * 0.08);
  score += Math.min(0.08, packet.entities.products.length * 0.04);
  if (packet.facts.exploitStatus === "exploited") score += 0.16;
  if (packet.facts.recordCounts.length > 0) score += 0.08;
  if (packet.entities.actors.length > 0) score += 0.1;
  score -= packet.uncertainty.length * 0.08;
  return clamp01(score);
}

function trustScore(stories: Story[]): number {
  if (stories.length === 0) return 0;
  const scores = stories.map((story) => scoreSourceTrust(story).score);
  return clamp01(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function differentiationScore(
  lane: TopicLane,
  packet: ReturnType<typeof buildEvidencePacket>,
): number {
  let score = 0.35;
  if (packet.sourceCount > 1) score += 0.18;
  if (packet.hasPrimaryEvidence) score += 0.12;
  if (packet.entities.actors.length > 0 || packet.facts.iocSignals.length > 0) {
    score += 0.14;
  }
  if (lane !== "vulnerabilities") score += 0.1;
  if (packet.uncertainty.includes("low-concrete-fact-density")) score -= 0.2;
  return clamp01(score);
}

function portfolioScore(lane: TopicLane): number {
  if (lane === "vulnerabilities") return 0.48;
  if (
    lane === "ransomware" ||
    lane === "apt-state-actors" ||
    lane === "breaches"
  ) {
    return 0.82;
  }
  return 0.65;
}

function clusterText(cluster: StoryCluster<Story>): string {
  return cluster.stories
    .flatMap((story) => [
      story.title,
      story.excerpt,
      story.rawText,
      ...(story.tags ?? []),
    ])
    .filter(Boolean)
    .join(" ");
}

const STRATEGIC_CVE_TERMS = [
  "microsoft",
  "windows",
  "exchange",
  "google",
  "chrome",
  "android",
  "apple",
  "ios",
  "macos",
  "mozilla",
  "firefox",
  "cisco",
  "fortinet",
  "palo alto",
  "pan-os",
  "ivanti",
  "vmware",
  "broadcom",
  "oracle",
  "sap",
  "linux",
  "linux kernel",
  "openssl",
  "openssh",
  "apache",
  "nginx",
  "kubernetes",
  "docker",
  "gitlab",
  "github",
  "jenkins",
  "atlassian",
  "confluence",
  "jira",
  "nvidia",
  "cuda",
  "tensorrt",
  "trt-llm",
  "openai",
  "chatgpt",
  "anthropic",
  "claude",
];

function isNvdOnly(cluster: StoryCluster<Story>, lane: TopicLane): boolean {
  return (
    lane === "vulnerabilities" &&
    cluster.stories.length > 0 &&
    cluster.stories.every(
      (story) =>
        story.sourceType === "nvd-json" ||
        story.sourceId === "nvd-recent" ||
        /NVD/i.test(story.sourceName ?? ""),
    )
  );
}

function hasCisaKevEvidence(cluster: StoryCluster<Story>): boolean {
  return cluster.stories.some(
    (story) =>
      story.sourceType === "cisa-kev" ||
      story.sourceId === "cisa-kev" ||
      /CISA Known Exploited Vulnerabilities/i.test(story.sourceName ?? ""),
  );
}

function hasStrategicCveContext(cluster: StoryCluster<Story>): boolean {
  const text = clusterText(cluster).toLowerCase();
  return STRATEGIC_CVE_TERMS.some((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
      text,
    ),
  );
}

function hasNonNvdPrimaryEvidence(cluster: StoryCluster<Story>): boolean {
  return cluster.stories.some((story) => {
    if (
      story.sourceType === "nvd-json" ||
      story.sourceId === "nvd-recent" ||
      /NVD/i.test(story.sourceName ?? "")
    ) {
      return false;
    }
    return (
      story.verificationRole === "primary-evidence" ||
      story.sourceClass === "government" ||
      story.sourceClass === "primary" ||
      story.sourceClass === "vendor-advisory" ||
      story.sourceType === "cisa-kev"
    );
  });
}

function hasLowOrMediumSeverityLabel(cluster: StoryCluster<Story>): boolean {
  return /\bseverity\s*:\s*(?:low|medium)\b|\b(?:low|medium)[-\s]+severity\b/i.test(
    clusterText(cluster),
  );
}

function lowValueRoundupReason(cluster: StoryCluster<Story>): string | null {
  const text = clusterText(cluster);
  if (
    /\b(?:weekly recap|week in (?:cybersecurity|security)|week\s+\d{1,2}|stormcast|wrap[- ]?up|roundup)\b/i.test(
      text,
    )
  ) {
    return "low-value-roundup";
  }
  return null;
}

function averageProfileScore(
  profileScores: Record<string, number>,
  keys: string[],
): number | null {
  const scores = keys
    .map((key) => profileScores[key])
    .filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function inferredPositiveSignals(input: {
  lane: TopicLane;
  demandScore: number;
  trustScore: number;
  evidenceScore: number;
  differentiationScore: number;
  packet: ReturnType<typeof buildEvidencePacket>;
  cluster: StoryCluster<Story>;
}): PositiveTasteSignal[] {
  const text = clusterText(input.cluster).toLowerCase();
  const signals: PositiveTasteSignal[] = [];
  if (
    input.demandScore >= 0.65 ||
    /\b(?:breaking|warns?|zero-day|ransomware|breach|openai|ai)\b/.test(text)
  ) {
    signals.push("hot-topic");
  }
  if (
    input.packet.facts.exploitStatus === "exploited" ||
    /\bactively exploited|exploited in (?:the )?wild\b/i.test(text)
  ) {
    signals.push("active-exploitation");
  }
  const currentYear = new Date().getUTCFullYear();
  const hasOlderExploitationContext =
    input.packet.entities.cves.some((cve) => {
      const year = Number(cve.match(/^CVE-(\d{4})-/)?.[1]);
      return Number.isFinite(year) && year <= currentYear - 1;
    }) && input.packet.facts.exploitStatus === "exploited";
  if (
    hasOlderExploitationContext ||
    /\b(?:historical exploitation|previously exploited|legacy exploitation)\b/i.test(
      text,
    )
  ) {
    signals.push("historical-exploitation");
  }
  if (input.demandScore >= 0.6) signals.push("reader-likely-cares");
  if (
    input.packet.entities.cves.length > 0 ||
    input.packet.facts.iocSignals.length > 0 ||
    /\b(?:mitigation|patch|detection|ioc|defenders?|apply updates?)\b/i.test(
      text,
    )
  ) {
    signals.push("defender-actionable");
  }
  if (input.trustScore >= 0.75) signals.push("strong-source");
  if (input.packet.hasPrimaryEvidence && input.differentiationScore >= 0.6) {
    signals.push("original-angle");
  }
  if (input.lane !== "vulnerabilities") signals.push("portfolio-balance");
  if (input.demandScore >= 0.65) signals.push("seo-opportunity");
  if (
    input.evidenceScore >= 0.5 &&
    input.trustScore >= 0.7 &&
    input.differentiationScore >= 0.5
  ) {
    signals.push("brand-fit");
  }
  return [...new Set(signals)];
}

function inferredNegativeSignals(input: {
  demandScore: number;
  trustScore: number;
  packet: ReturnType<typeof buildEvidencePacket>;
  cluster: StoryCluster<Story>;
}): NegativeTasteSignal[] {
  const text = clusterText(input.cluster).toLowerCase();
  const signals: NegativeTasteSignal[] = [];
  if (
    input.packet.sourceCount <= 1 &&
    input.packet.uncertainty.includes("low-concrete-fact-density")
  ) {
    signals.push("generic-rewrite");
  }
  if (input.trustScore < 0.45) signals.push("weak-source");
  if (input.demandScore < 0.3) signals.push("low-reader-value");
  if (input.packet.uncertainty.includes("no-primary-source")) {
    signals.push("too-speculative");
  }
  if (
    /\b(?:webinar|joins|partner|integration|gartner|magic quadrant)\b/i.test(
      text,
    )
  ) {
    signals.push("too-vendor-pr");
  }
  if (newestAgeHours(input.cluster) > 24 * 14) signals.push("stale-topic");
  if (
    input.packet.entities.cves.length === 0 &&
    input.packet.facts.iocSignals.length === 0 &&
    !/\b(?:mitigation|patch|detection|defenders?)\b/i.test(text)
  ) {
    signals.push("no-actionable-angle");
  }
  return [...new Set(signals)];
}

function applyTasteProfile(input: {
  profile?: EditorialTasteProfile | null;
  lane: TopicLane;
  sourceNames: string[];
  reasonTags: string[];
  positiveSignals: PositiveTasteSignal[];
  negativeSignals: NegativeTasteSignal[];
}): { adjustment: number; reasons: string[]; matchedPatterns: TastePattern[] } {
  const profile = input.profile;
  if (!profile || profile.reviewedCandidateCount === 0) {
    return { adjustment: 0, reasons: [], matchedPatterns: [] };
  }
  let adjustment = 0;
  const reasons: string[] = [];
  const matchedPatterns: TastePattern[] = [];

  function addPattern(
    kind: TastePattern["kind"],
    key: string,
    averageRating: number,
    count: number,
    weight: number,
  ) {
    const delta = (averageRating - 0.5) * weight;
    adjustment += delta;
    matchedPatterns.push({ kind, key, averageRating, count });
    reasons.push(
      `${delta >= 0 ? "taste-boost" : "taste-suppress"}:${kind}:${key}:${averageRating}`,
    );
  }

  const laneScore = profile.laneScores[input.lane];
  if (typeof laneScore === "number") {
    addPattern(
      "lane",
      input.lane,
      laneScore,
      profile.laneCounts[input.lane] ?? 0,
      0.08,
    );
  }
  const sourceScore = averageProfileScore(
    profile.sourceScores,
    input.sourceNames,
  );
  if (sourceScore !== null)
    addPattern("source", "matched-source", sourceScore, 1, 0.04);
  const reasonScore = averageProfileScore(
    profile.reasonTagScores,
    input.reasonTags,
  );
  if (reasonScore !== null) {
    addPattern("selection-reason", "matched-reason", reasonScore, 1, 0.05);
  }
  const positiveScore = averageProfileScore(
    profile.positiveSignalScores,
    input.positiveSignals,
  );
  if (positiveScore !== null) {
    addPattern("positive-signal", "matched-positive", positiveScore, 1, 0.08);
  }
  const negativeScore = averageProfileScore(
    profile.negativeSignalScores,
    input.negativeSignals,
  );
  if (negativeScore !== null && negativeScore < 0.6) {
    addPattern("negative-signal", "matched-negative", negativeScore, 1, 0.1);
  }

  return {
    adjustment: Math.max(
      -0.15,
      Math.min(0.15, Math.round(adjustment * 100) / 100),
    ),
    reasons,
    matchedPatterns,
  };
}

function cvePublishBlockReason(
  packet: ReturnType<typeof buildEvidencePacket>,
  cluster: StoryCluster<Story>,
  lane: TopicLane,
): string | null {
  if (
    lane !== "vulnerabilities" ||
    packet.entities.cves.length === 0 ||
    packet.facts.exploitStatus === "exploited" ||
    hasCisaKevEvidence(cluster)
  ) {
    return null;
  }

  const highestCvss = Math.max(...packet.facts.cvssScores, 0);
  const nvdOnly = isNvdOnly(cluster, lane);
  const strategic = hasStrategicCveContext(cluster);
  const hasCorroboratedPrimary =
    hasNonNvdPrimaryEvidence(cluster) && packet.sourceCount >= 2;

  if (highestCvss === 0) return "missing-cvss";
  if (highestCvss < 9) return "below-critical-cvss";
  if (nvdOnly && !strategic) return "nvd-only-obscure-cve";
  if (!strategic && !hasCorroboratedPrimary) return "weak-product-relevance";

  return null;
}

function staleVulnerabilityPenalty(
  lane: TopicLane,
  packet: ReturnType<typeof buildEvidencePacket>,
): number {
  if (lane !== "vulnerabilities") return 0;
  const currentYear = new Date().getUTCFullYear();
  const hasOldOnly =
    packet.entities.cves.length > 0 &&
    packet.entities.cves.every((cve) => {
      const year = Number(cve.match(/^CVE-(\d{4})-/)?.[1]);
      return Number.isFinite(year) && year <= currentYear - 3;
    });
  if (hasOldOnly && packet.facts.exploitStatus !== "exploited") return 0.24;
  return 0;
}

function decide(
  score: number,
  evidence: number,
  demand: number,
  packet: ReturnType<typeof buildEvidencePacket>,
  cluster: StoryCluster<Story>,
  lane: TopicLane,
): PublishDecision {
  if (
    packet.uncertainty.includes("low-concrete-fact-density") &&
    !packet.hasPrimaryEvidence
  ) {
    return "research-more";
  }
  if (lowValueRoundupReason(cluster)) return "digest-only";
  const nvdOnly = isNvdOnly(cluster, lane);
  const highestCvss = Math.max(...packet.facts.cvssScores, 0);
  const cveBlockReason = cvePublishBlockReason(packet, cluster, lane);
  if (cveBlockReason) return "digest-only";
  if (
    nvdOnly &&
    packet.facts.exploitStatus !== "exploited" &&
    highestCvss < 9
  ) {
    return "digest-only";
  }
  if (
    lane === "vulnerabilities" &&
    packet.entities.cves.length > 0 &&
    packet.facts.exploitStatus !== "exploited"
  ) {
    if (highestCvss > 0 && highestCvss < 9) return "digest-only";
    if (highestCvss === 0 && hasLowOrMediumSeverityLabel(cluster)) {
      return "digest-only";
    }
  }
  if (score >= 0.5 && evidence >= 0.38 && demand >= 0.28) return "publish-now";
  if (score >= 0.46) return "research-more";
  if (score >= 0.32) return "digest-only";
  return "reject";
}

function reasonsFor(
  selection: Omit<EditorialSelection, "reasons" | "decision">,
  packet: ReturnType<typeof buildEvidencePacket>,
  cluster: StoryCluster<Story>,
): string[] {
  const reasons: string[] = [];
  if (selection.evidenceScore >= 0.6) reasons.push("strong evidence");
  if (selection.trustScore >= 0.75) reasons.push("trusted sources");
  if (selection.demandScore >= 0.65) reasons.push("search demand");
  if (selection.portfolioScore >= 0.8)
    reasons.push(`portfolio:${selection.lane}`);
  const cveBlockReason = cvePublishBlockReason(packet, cluster, selection.lane);
  if (cveBlockReason) reasons.push(cveBlockReason);
  const roundupReason = lowValueRoundupReason(cluster);
  if (roundupReason) reasons.push(roundupReason);
  for (const uncertainty of packet.uncertainty) reasons.push(uncertainty);
  return reasons.length > 0 ? reasons : ["low selection score"];
}

export function selectEditorialCandidates<T extends Story>(
  clusters: StoryCluster<T>[],
  options: {
    maxArticles: number;
    tasteProfile?: EditorialTasteProfile | null;
  } = { maxArticles: 5 },
): EditorialSelectorResult<T> {
  const scored = clusters.map((cluster) => {
    const packet = buildEvidencePacket(cluster as StoryCluster<Story>);
    const first = cluster.stories[0];
    const lane = classifyTopicLane({
      title: first?.title ?? "",
      excerpt: first?.excerpt ?? "",
      tags: cluster.stories.flatMap((story) => story.tags),
    });
    const demand = scoreSearchDemand({
      title: first?.title ?? "",
      excerpt: first?.excerpt ?? "",
      tags: cluster.stories.flatMap((story) => story.tags),
      cves: packet.entities.cves,
      actors: packet.entities.actors,
      products: packet.entities.products,
      victims: packet.entities.victims,
    }).score;
    const rawPartial = {
      clusterKey: cluster.key,
      score: 0,
      lane,
      evidenceScore: evidenceScore(packet),
      trustScore: trustScore(cluster.stories),
      demandScore: demand,
      freshnessScore: freshnessScore(cluster as StoryCluster<Story>),
      differentiationScore: differentiationScore(lane, packet),
      portfolioScore: portfolioScore(lane),
      tasteProfileScore: 0,
      tasteProfileReasons: [],
    };
    const baseScore =
      rawPartial.evidenceScore * 0.28 +
      rawPartial.trustScore * 0.18 +
      rawPartial.demandScore * 0.22 +
      rawPartial.freshnessScore * 0.12 +
      rawPartial.differentiationScore * 0.12 +
      rawPartial.portfolioScore * 0.08 -
      staleVulnerabilityPenalty(lane, packet);
    const baseReasons = reasonsFor(
      { ...rawPartial, score: clamp01(baseScore) },
      packet,
      cluster as StoryCluster<Story>,
    );
    const positiveSignals = inferredPositiveSignals({
      lane,
      demandScore: rawPartial.demandScore,
      trustScore: rawPartial.trustScore,
      evidenceScore: rawPartial.evidenceScore,
      differentiationScore: rawPartial.differentiationScore,
      packet,
      cluster: cluster as StoryCluster<Story>,
    });
    const negativeSignals = inferredNegativeSignals({
      demandScore: rawPartial.demandScore,
      trustScore: rawPartial.trustScore,
      packet,
      cluster: cluster as StoryCluster<Story>,
    });
    const taste = applyTasteProfile({
      profile: options.tasteProfile,
      lane,
      sourceNames: packet.sourceNames,
      reasonTags: baseReasons,
      positiveSignals,
      negativeSignals,
    });
    const score = clamp01(baseScore + taste.adjustment);
    const partial = {
      ...rawPartial,
      tasteProfileScore: taste.adjustment,
      tasteProfileReasons: taste.reasons,
    };
    const withScore = { ...partial, score };
    const decision = decide(
      score,
      partial.evidenceScore,
      demand,
      packet,
      cluster as StoryCluster<Story>,
      lane,
    );
    const selection: EditorialSelection = {
      ...withScore,
      decision,
      reasons: [...baseReasons, ...taste.reasons.slice(0, 4)],
    };
    return { cluster, selection };
  });

  const sorted = scored.sort(
    (a, b) =>
      b.selection.score - a.selection.score ||
      a.cluster.key.localeCompare(b.cluster.key),
  );
  const publishable: Array<(typeof sorted)[number] & { clusterKey: string }> =
    [];
  const cappedReasons = new Map<string, string>();
  let cveStyleCount = 0;
  for (const item of sorted.filter(
    (candidate) => candidate.selection.decision === "publish-now",
  )) {
    const cveStyle =
      item.cluster.key.startsWith("cve:") ||
      item.cluster.stories.some((story) =>
        /\bCVE-\d{4}-\d{4,}\b/i.test(story.title),
      );
    if (cveStyle && cveStyleCount >= 1) {
      cappedReasons.set(item.cluster.key, CVE_STYLE_DAILY_CAP_REASON);
      continue;
    }
    publishable.push({ ...item, clusterKey: item.cluster.key });
    if (cveStyle) cveStyleCount++;
    if (publishable.length >= options.maxArticles) break;
  }
  const chosen = new Set(publishable.map((item) => item.cluster.key));
  const decisions = sorted.map((item) =>
    chosen.has(item.cluster.key)
      ? item.selection
      : item.selection.decision === "publish-now"
        ? {
            ...item.selection,
            decision: "digest-only" as const,
            reasons: [
              ...item.selection.reasons,
              cappedReasons.get(item.cluster.key) ?? ARTICLE_DAILY_LIMIT_REASON,
            ],
          }
        : item.selection,
  );
  return { publishable, decisions };
}
