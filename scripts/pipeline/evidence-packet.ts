import { extractCVEs, type Story } from "../utils/dedup.js";
import { extractIocs } from "./extract-iocs.js";
import { extractThreatActor } from "./post-process.js";
import type { StoryCluster } from "./story-clustering.js";

export interface EvidencePacket {
  clusterKey: string;
  sourceUrls: string[];
  sourceNames: string[];
  sourceCount: number;
  hasPrimaryEvidence: boolean;
  entities: {
    cves: string[];
    products: string[];
    vendors: string[];
    actors: string[];
    victims: string[];
    sectors: string[];
    regions: string[];
  };
  facts: {
    cvssScores: number[];
    exploitStatus: "exploited" | "poc" | "patched" | "unknown";
    recordCounts: string[];
    affectedVersions: string[];
    iocSignals: string[];
    ttpSignals: string[];
  };
  uncertainty: string[];
}

const VENDOR_TERMS = [
  "Microsoft",
  "Google",
  "Apple",
  "Cisco",
  "Fortinet",
  "Palo Alto",
  "Ivanti",
  "GitHub",
  "VMware",
  "Oracle",
  "SAP",
  "Linux",
  "Chrome",
  "Exchange",
  "Windows",
  "Mozilla",
  "Firefox",
  "Android",
  "WordPress",
  "Drupal",
  "GitLab",
  "Atlassian",
  "Confluence",
  "Jira",
  "Jenkins",
  "Kubernetes",
  "Docker",
  "Apache",
  "Nginx",
  "OpenSSL",
  "OpenSSH",
  "Broadcom",
  "NVIDIA",
  "CUDA",
  "TensorRT",
  "TRT-LLM",
  "Open WebUI",
  "MCP",
  "ChatGPT",
  "OpenAI",
  "Anthropic",
  "Claude",
];

const SECTOR_TERMS = [
  "healthcare",
  "hospital",
  "financial",
  "government",
  "education",
  "retail",
  "manufacturing",
  "energy",
];

const REGION_TERMS = [
  "US",
  "United States",
  "UK",
  "Europe",
  "EU",
  "China",
  "Russia",
  "Ukraine",
  "Japan",
  "India",
  "Australia",
];

function uniq<T>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function storyText(story: Story): string {
  return [story.title, story.excerpt, story.rawText, ...(story.tags ?? [])]
    .filter(Boolean)
    .join(" ");
}

function extractCvss(text: string): number[] {
  return uniq(
    [
      ...text.matchAll(
        /\bCVSS(?:\s*v?[234]\.?[01]?)?(?:\s*(?:base\s+)?score)?\s*[:=]?\s*(10(?:\.0)?|[0-9](?:\.[0-9])?)\b/gi,
      ),
    ]
      .map((match) => Number(match[1]))
      .filter((score) => Number.isFinite(score) && score >= 0 && score <= 10),
  );
}

function exploitStatus(text: string): EvidencePacket["facts"]["exploitStatus"] {
  if (
    /\bactively exploited|exploited in (?:the )?wild|known exploited\b/i.test(
      text,
    )
  ) {
    return "exploited";
  }
  if (
    /\bproof[- ]of[- ]concept|public poc|exploit released|metasploit\b/i.test(
      text,
    )
  ) {
    return "poc";
  }
  if (
    /\bpatch(?:ed|es)?|fixed release|security update|advisory\b/i.test(text)
  ) {
    return "patched";
  }
  return "unknown";
}

function extractCounts(text: string): string[] {
  return uniq(
    [
      ...text.matchAll(
        /\b\d[\d,.]*\s*(?:k|m|million|billion)?\s+(?:records|users|customers|accounts|patients|employees|students|devices|servers)\b/gi,
      ),
    ].map((match) => match[0].replace(/\s+/g, " ").trim()),
  );
}

function extractVersions(text: string): string[] {
  return uniq(
    [...text.matchAll(/\b(?:version|versions|v)\s+\d+(?:\.\d+){1,3}\b/gi)].map(
      (match) => match[0],
    ),
  );
}

function matchingTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) =>
    new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(text),
  );
}

export function buildEvidencePacket(
  cluster: StoryCluster<Story>,
): EvidencePacket {
  const combined = cluster.stories.map(storyText).join("\n");
  const actors = uniq(
    cluster.stories
      .map((story) => extractThreatActor(storyText(story)))
      .filter((actor): actor is string => Boolean(actor)),
  );
  const iocs = extractIocs({ body: combined, sourceText: combined });
  const cves = uniq(extractCVEs(combined));
  const cvssScores = extractCvss(combined);
  const status = exploitStatus(combined);
  const sourceNames = uniq(cluster.stories.map((story) => story.sourceName));
  const hasPrimaryEvidence = cluster.stories.some(
    (story) =>
      story.verificationRole === "primary-evidence" ||
      story.sourceClass === "government" ||
      story.sourceClass === "primary" ||
      story.sourceClass === "structured-vulnerability" ||
      story.sourceType === "cisa-kev" ||
      story.sourceType === "nvd-json",
  );
  const uncertainty: string[] = [];
  if (sourceNames.length < 2 && !hasPrimaryEvidence)
    uncertainty.push("single-source");
  if (
    cves.length + cvssScores.length + iocs.length + actors.length < 2 &&
    sourceNames.length < 2
  ) {
    uncertainty.push("low-concrete-fact-density");
  }
  if (!hasPrimaryEvidence) uncertainty.push("no-primary-source");

  return {
    clusterKey: cluster.key,
    sourceUrls: uniq(cluster.stories.map((story) => story.url).filter(Boolean)),
    sourceNames,
    sourceCount: sourceNames.length,
    hasPrimaryEvidence,
    entities: {
      cves,
      products: matchingTerms(combined, VENDOR_TERMS),
      vendors: matchingTerms(combined, VENDOR_TERMS),
      actors,
      victims: [],
      sectors: matchingTerms(combined, SECTOR_TERMS),
      regions: matchingTerms(combined, REGION_TERMS),
    },
    facts: {
      cvssScores,
      exploitStatus: status,
      recordCounts: extractCounts(combined),
      affectedVersions: extractVersions(combined),
      iocSignals: iocs.map((ioc) => ioc.value),
      ttpSignals: uniq(
        [...combined.matchAll(/\bT\d{4}(?:\.\d{3})?\b/g)].map((m) => m[0]),
      ),
    },
    uncertainty,
  };
}
