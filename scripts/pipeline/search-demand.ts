import fs from "node:fs";
import path from "node:path";

export type TopicLane =
  | "vulnerabilities"
  | "ransomware"
  | "apt-state-actors"
  | "breaches"
  | "malware"
  | "ai-security"
  | "defender-ops"
  | "policy";

export interface SearchDemandInput {
  title: string;
  excerpt: string;
  tags: string[];
  cves?: string[];
  actors?: string[];
  products?: string[];
  victims?: string[];
}

export interface SearchDemandScore {
  score: number;
  matchedHints: string[];
}

type DemandHints = {
  entities?: Record<string, number>;
  patterns?: Record<string, number>;
};

const DEFAULT_HINTS: Required<DemandHints> = {
  entities: {
    microsoft: 0.8,
    windows: 0.8,
    exchange: 0.8,
    chrome: 0.75,
    github: 0.75,
    mozilla: 0.72,
    firefox: 0.72,
    cisco: 0.75,
    nvidia: 0.75,
    "trt-llm": 0.7,
    tensorrt: 0.7,
    wordpress: 0.58,
    openai: 0.82,
    chatgpt: 0.78,
    anthropic: 0.74,
    claude: 0.72,
    "ai security": 0.82,
    daybreak: 0.72,
    ransomware: 0.7,
    shinyhunters: 0.7,
    "mcgraw hill": 0.65,
  },
  patterns: {
    "CVE-": 0.8,
    KB: 0.7,
    "zero-day": 0.85,
    "actively exploited": 0.9,
    "data breach": 0.75,
    ransomware: 0.75,
    APT: 0.72,
    malware: 0.68,
    cybersecurity: 0.6,
    "supply chain": 0.66,
    "content provenance": 0.58,
    "prompt injection": 0.72,
    "AI safety": 0.62,
  },
};

const SEARCH_DEMAND_HINTS_PATH = path.join(
  process.cwd(),
  "data",
  "search-demand-hints.json",
);
const GSC_DEMAND_HINTS_PATH = path.join(
  process.cwd(),
  "data",
  "gsc-demand-hints.json",
);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function loadDemandHints(filePath?: string): Required<DemandHints> {
  const resolvedPath =
    filePath ??
    (fs.existsSync(GSC_DEMAND_HINTS_PATH)
      ? GSC_DEMAND_HINTS_PATH
      : SEARCH_DEMAND_HINTS_PATH);
  if (!fs.existsSync(resolvedPath)) return DEFAULT_HINTS;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(resolvedPath, "utf-8"),
    ) as DemandHints;
    return {
      entities: { ...DEFAULT_HINTS.entities, ...(parsed.entities ?? {}) },
      patterns: { ...DEFAULT_HINTS.patterns, ...(parsed.patterns ?? {}) },
    };
  } catch {
    return DEFAULT_HINTS;
  }
}

export function scoreSearchDemand(
  input: SearchDemandInput,
  hints = loadDemandHints(),
): SearchDemandScore {
  const haystack = [
    input.title,
    input.excerpt,
    ...(input.tags ?? []),
    ...(input.cves ?? []),
    ...(input.actors ?? []),
    ...(input.products ?? []),
    ...(input.victims ?? []),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0.18;
  const matchedHints: string[] = [];

  for (const [entity, weight] of Object.entries(hints.entities)) {
    if (haystack.includes(entity.toLowerCase())) {
      score += weight * 0.22;
      matchedHints.push(`entity:${entity}`);
    }
  }
  for (const [pattern, weight] of Object.entries(hints.patterns)) {
    if (haystack.includes(pattern.toLowerCase())) {
      score += weight * 0.28;
      matchedHints.push(`pattern:${pattern}`);
    }
  }
  if ((input.cves ?? []).length > 0) {
    score += 0.22;
    if (!matchedHints.includes("pattern:CVE-")) {
      matchedHints.push("pattern:CVE-");
    }
  }
  return { score: clamp01(score), matchedHints };
}

export function classifyTopicLane(input: {
  title: string;
  excerpt: string;
  tags?: string[];
}): TopicLane {
  const text =
    `${input.title} ${input.excerpt} ${(input.tags ?? []).join(" ")}`.toLowerCase();
  const hasStrongVulnerabilitySignal =
    /\bcve-\d{4}-\d{4,}|cvss|cisa kev|known exploited vulnerabilities|\bkev\b|actively exploited|exploited in (?:the )?wild/.test(
      text,
    );
  const hasZeroDayFlawSignal =
    /\bzero-day (?:vulnerability|flaw|bug|exploit)\b/.test(text);
  const isDisclosurePolicyCommentary =
    /\bzero-day\b/.test(text) &&
    /\b(?:release|releases|released|disclosure|researcher|researchers|backlash|justifiable|criticism|policy|drop more)\b/.test(
      text,
    );

  if (
    isDisclosurePolicyCommentary &&
    !hasStrongVulnerabilitySignal &&
    !hasZeroDayFlawSignal
  ) {
    return "policy";
  }
  if (
    hasStrongVulnerabilitySignal ||
    hasZeroDayFlawSignal ||
    /\bvulnerability\b/.test(text)
  ) {
    return "vulnerabilities";
  }
  if (/\bransomware|extortion|leak site|lockbit|blackcat|cl0p\b/.test(text)) {
    return "ransomware";
  }
  if (
    /\bapt\d*|state-backed|state sponsored|nation-state|lazarus|cozy bear|fancy bear\b/.test(
      text,
    )
  ) {
    return "apt-state-actors";
  }
  if (
    /\bdata breach|breach|stolen data|records exposed|customer data\b/.test(
      text,
    )
  ) {
    return "breaches";
  }
  if (/\bmalware|trojan|backdoor|loader|infostealer|rat\b/.test(text)) {
    return "malware";
  }
  if (/\bpatch(?:ed|es|ing)?\b/.test(text)) {
    return "vulnerabilities";
  }
  if (
    /\bai\b|llm|agentic|model|prompt injection|openai|chatgpt|anthropic|claude|daybreak\b/.test(
      text,
    )
  ) {
    return "ai-security";
  }
  if (/\bpolicy|regulation|law|government|court|fine\b/.test(text)) {
    return "policy";
  }
  return "defender-ops";
}
