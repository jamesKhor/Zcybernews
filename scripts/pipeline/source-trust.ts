export type SourceClass =
  | "primary"
  | "government"
  | "vendor-advisory"
  | "security-research"
  | "reputable-media"
  | "structured-vulnerability"
  | "community"
  | "social"
  | "forum"
  | "unknown";

export type NoiseRisk =
  | "none"
  | "press-release"
  | "webinar"
  | "recap"
  | "syndication"
  | "unknown";

export type VerificationRole =
  | "primary-evidence"
  | "corroboration"
  | "context"
  | "weak-signal"
  | "ingest-only";

export interface SourceTrustInput {
  sourceClass?: SourceClass;
  authorityScore?: number;
  originalityScore?: number;
  noiseRisk?: NoiseRisk;
  verificationRole?: VerificationRole;
  id?: string;
  name?: string;
  type?: string;
  category?: string;
  enabled?: boolean;
  tier?: string;
  description?: string;
}

export interface SourceTrustScore {
  score: number;
  boosts: string[];
  penalties: string[];
}

const CLASS_BASE: Record<SourceClass, number> = {
  primary: 0.92,
  government: 0.9,
  "vendor-advisory": 0.78,
  "security-research": 0.82,
  "reputable-media": 0.68,
  "structured-vulnerability": 0.88,
  community: 0.45,
  social: 0.3,
  forum: 0.28,
  unknown: 0.4,
};

const ROLE_BOOST: Record<VerificationRole, number> = {
  "primary-evidence": 0.08,
  corroboration: 0.04,
  context: 0,
  "weak-signal": -0.12,
  "ingest-only": -0.2,
};

const NOISE_PENALTY: Record<NoiseRisk, number> = {
  none: 0,
  "press-release": -0.16,
  webinar: -0.18,
  recap: -0.1,
  syndication: -0.14,
  unknown: -0.04,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function scoreSourceTrust(input: SourceTrustInput): SourceTrustScore {
  const sourceClass = input.sourceClass ?? "unknown";
  const verificationRole = input.verificationRole ?? "context";
  const noiseRisk = input.noiseRisk ?? "unknown";
  const boosts: string[] = [];
  const penalties: string[] = [];

  let score = CLASS_BASE[sourceClass];
  if (typeof input.authorityScore === "number") {
    score = score * 0.45 + clamp01(input.authorityScore) * 0.55;
  }
  if (typeof input.originalityScore === "number") {
    const originality = clamp01(input.originalityScore);
    score += (originality - 0.5) * 0.16;
    if (originality >= 0.75) boosts.push("originality");
    if (originality <= 0.3) penalties.push("low-originality");
  }

  const roleDelta = ROLE_BOOST[verificationRole];
  score += roleDelta;
  if (roleDelta > 0) boosts.push(`role:${verificationRole}`);
  if (roleDelta < 0) penalties.push(`role:${verificationRole}`);

  const noiseDelta = NOISE_PENALTY[noiseRisk];
  score += noiseDelta;
  if (noiseDelta < 0) penalties.push(`noise:${noiseRisk}`);

  if (sourceClass === "government" || sourceClass === "primary") {
    boosts.push(`class:${sourceClass}`);
  }
  if (sourceClass === "social" || sourceClass === "forum") {
    penalties.push(`class:${sourceClass}`);
  }

  return { score: clamp01(score), boosts, penalties };
}

export function inferSourceTrust(
  source: SourceTrustInput,
): Required<
  Pick<
    SourceTrustInput,
    | "sourceClass"
    | "authorityScore"
    | "originalityScore"
    | "noiseRisk"
    | "verificationRole"
  >
> {
  if (source.sourceClass) {
    return {
      sourceClass: source.sourceClass,
      authorityScore: source.authorityScore ?? 0.6,
      originalityScore: source.originalityScore ?? 0.55,
      noiseRisk: source.noiseRisk ?? "unknown",
      verificationRole: source.verificationRole ?? "context",
    };
  }

  const id = (source.id ?? "").toLowerCase();
  const name = (source.name ?? "").toLowerCase();
  const type = (source.type ?? "").toLowerCase();
  const description = (source.description ?? "").toLowerCase();
  const tier = (source.tier ?? "").toLowerCase();

  if (type === "cisa-kev" || id.includes("cisa")) {
    return {
      sourceClass: "government",
      authorityScore: 0.96,
      originalityScore: 0.86,
      noiseRisk: "none",
      verificationRole: "primary-evidence",
    };
  }
  if (type === "nvd-json" || id.includes("nvd")) {
    return {
      sourceClass: "structured-vulnerability",
      authorityScore: 0.93,
      originalityScore: 0.74,
      noiseRisk: "none",
      verificationRole: "primary-evidence",
    };
  }
  if (type.includes("advisory") || name.includes("psirt")) {
    return {
      sourceClass: "vendor-advisory",
      authorityScore: 0.82,
      originalityScore: 0.78,
      noiseRisk: "none",
      verificationRole: "primary-evidence",
    };
  }
  if (
    tier === "trusted" ||
    description.includes("original") ||
    description.includes("research")
  ) {
    return {
      sourceClass: "security-research",
      authorityScore: 0.78,
      originalityScore: 0.76,
      noiseRisk: "none",
      verificationRole: "corroboration",
    };
  }
  if (
    description.includes("aggregator") ||
    description.includes("roundup") ||
    description.includes("wire")
  ) {
    return {
      sourceClass: "reputable-media",
      authorityScore: 0.62,
      originalityScore: 0.38,
      noiseRisk: "syndication",
      verificationRole: "context",
    };
  }
  if (
    description.includes("webinar") ||
    description.includes("product") ||
    description.includes("press release")
  ) {
    return {
      sourceClass: "reputable-media",
      authorityScore: 0.5,
      originalityScore: 0.35,
      noiseRisk: "press-release",
      verificationRole: "weak-signal",
    };
  }

  return {
    sourceClass: "reputable-media",
    authorityScore: 0.62,
    originalityScore: 0.55,
    noiseRisk: "unknown",
    verificationRole: "context",
  };
}
