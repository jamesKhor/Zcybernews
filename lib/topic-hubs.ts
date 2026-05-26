import type { Article } from "./content";
import { getAllPosts } from "./content";
import type { ArticleLocale, ArticleSection } from "./article-url";
import { isPublicArticle } from "./publication";
import { tagUrlSlug } from "./public-tags";
import type { ArticleFrontmatter, Category } from "./types";

export const PUBLIC_TOPIC_HUB_THRESHOLD = 5;

export interface TopicHubDefinition {
  slug: string;
  label: Record<ArticleLocale, string>;
  description: Record<ArticleLocale, string>;
  tagSlugs: string[];
  categories?: Category[];
  patterns?: RegExp[];
  requiresCve?: boolean;
}

export interface TopicHubArticle {
  article: Article;
  section: ArticleSection;
}

const TOPIC_HUBS: TopicHubDefinition[] = [
  {
    slug: "ransomware",
    label: { en: "Ransomware", zh: "勒索软件" },
    description: {
      en: "Recent ransomware, extortion, leak-site, and victim-claim coverage.",
      zh: "近期勒索软件、双重勒索、泄露站点与受害者声称报道。",
    },
    tagSlugs: [
      "ransomware",
      "extortion",
      "data-leak-site",
      "lockbit",
      "clop",
      "akira",
      "qilin",
      "blackcat",
      "alphv",
    ],
    patterns: [/ransomware/i, /\bransom\b/i, /extortion/i, /data leak site/i],
  },
  {
    slug: "malware",
    label: { en: "Malware", zh: "恶意软件" },
    description: {
      en: "Malware families, loaders, stealers, botnets, and intrusion tooling.",
      zh: "恶意软件家族、加载器、窃密木马、僵尸网络与入侵工具。",
    },
    tagSlugs: [
      "malware",
      "trojan",
      "backdoor",
      "loader",
      "botnet",
      "infostealer",
      "spyware",
      "stealer",
    ],
    categories: ["malware"],
    patterns: [/malware/i, /infostealer/i, /backdoor/i, /botnet/i],
  },
  {
    slug: "apt",
    label: { en: "APT Groups", zh: "APT 组织" },
    description: {
      en: "Nation-state and advanced persistent threat campaigns, actors, and tooling.",
      zh: "国家级与高级持续性威胁行动、攻击组织与工具链。",
    },
    tagSlugs: [
      "apt",
      "apt29",
      "apt28",
      "lazarus",
      "oceanlotus",
      "sandworm",
      "turla",
      "nation-state",
    ],
    patterns: [
      /\bAPT\d+\b/i,
      /advanced persistent/i,
      /nation-state/i,
      /lazarus/i,
      /oceanlotus/i,
      /sandworm/i,
    ],
  },
  {
    slug: "ai-security",
    label: { en: "AI Security", zh: "AI 安全" },
    description: {
      en: "AI security, LLM abuse, model governance, and defender AI coverage.",
      zh: "AI 安全、LLM 滥用、模型治理与防御者 AI 应用报道。",
    },
    tagSlugs: [
      "ai",
      "ai-security",
      "llm",
      "genai",
      "openai",
      "agentic-ai",
      "model-security",
    ],
    categories: ["ai"],
    patterns: [/\bAI\b/, /\bLLM\b/i, /agentic AI/i, /model security/i],
  },
  {
    slug: "active-cves",
    label: { en: "Active CVEs", zh: "活跃漏洞" },
    description: {
      en: "Exploited CVEs, zero-days, KEV additions, and urgent patch decisions.",
      zh: "已被利用漏洞、零日、KEV 新增与紧急修补决策。",
    },
    tagSlugs: ["cve", "kev", "zero-day", "0day", "exploitation", "exploited"],
    categories: ["vulnerabilities"],
    requiresCve: true,
    patterns: [/CVE-\d{4}-\d{4,}/i, /zero-day/i, /\bKEV\b/i, /exploited/i],
  },
  {
    slug: "breaches",
    label: { en: "Breaches", zh: "数据泄露" },
    description: {
      en: "Confirmed breaches, data leaks, exposed records, and disclosure fallout.",
      zh: "已确认入侵、数据泄露、记录暴露与披露后续影响。",
    },
    tagSlugs: ["breach", "data-breach", "data-leak", "leak", "exposed-data"],
    patterns: [/breach/i, /data leak/i, /records exposed/i, /stolen data/i],
  },
  {
    slug: "defender-ops",
    label: { en: "Defender Operations", zh: "防御运营" },
    description: {
      en: "Detection engineering, incident response, SOC operations, and hardening work.",
      zh: "检测工程、事件响应、SOC 运营与加固实践。",
    },
    tagSlugs: [
      "detection",
      "incident-response",
      "soc",
      "blue-team",
      "yara",
      "sigma",
      "hardening",
      "patch-management",
    ],
    categories: ["tools"],
    patterns: [/incident response/i, /\bSOC\b/, /detection/i, /hardening/i],
  },
  {
    slug: "policy",
    label: { en: "Cyber Policy", zh: "网络政策" },
    description: {
      en: "Government warnings, law enforcement actions, regulations, and policy moves.",
      zh: "政府预警、执法行动、法规与政策动态。",
    },
    tagSlugs: [
      "policy",
      "regulation",
      "government",
      "law-enforcement",
      "cisa",
      "fbi",
      "sanctions",
    ],
    categories: ["industry"],
    patterns: [/regulation/i, /law enforcement/i, /\bCISA\b/, /\bFBI\b/],
  },
];

const TOPIC_HUB_BY_SLUG = new Map(TOPIC_HUBS.map((hub) => [hub.slug, hub]));

function normalizeHubSlug(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = tagUrlSlug(value);
  return normalized.length > 0 ? normalized : null;
}

function searchableText(frontmatter: ArticleFrontmatter): string {
  return [
    frontmatter.title,
    frontmatter.excerpt,
    frontmatter.threat_actor,
    frontmatter.campaign,
    ...(frontmatter.tags ?? []),
    ...(frontmatter.cve_ids ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

function matchesTopicHub(
  frontmatter: ArticleFrontmatter,
  hub: TopicHubDefinition,
): boolean {
  const targetHub = normalizeHubSlug(frontmatter.target_hub);
  if (targetHub === hub.slug) return true;

  const linkTargets = new Set(
    (frontmatter.internal_link_targets ?? [])
      .map(normalizeHubSlug)
      .filter((slug): slug is string => Boolean(slug)),
  );
  if (linkTargets.has(hub.slug)) return true;

  const articleTagSlugs = new Set(frontmatter.tags.map(tagUrlSlug));
  if (hub.tagSlugs.some((tag) => articleTagSlugs.has(tag))) return true;

  if (hub.categories?.includes(frontmatter.category)) {
    if (!hub.requiresCve || (frontmatter.cve_ids?.length ?? 0) > 0) {
      return true;
    }
  }

  const text = searchableText(frontmatter);
  return Boolean(hub.patterns?.some((pattern) => pattern.test(text)));
}

export function getTopicHubDefinitions(): TopicHubDefinition[] {
  return TOPIC_HUBS;
}

export function getTopicHubDefinition(
  slug: string,
): TopicHubDefinition | undefined {
  const normalized = normalizeHubSlug(slug);
  return normalized ? TOPIC_HUB_BY_SLUG.get(normalized) : undefined;
}

export function topicHubUrl(slug: string, locale: ArticleLocale): string {
  const normalized = normalizeHubSlug(slug);
  if (!normalized || !TOPIC_HUB_BY_SLUG.has(normalized)) {
    throw new Error(`Unknown topic hub: ${slug}`);
  }
  return `/${locale}/topics/${normalized}`;
}

export function getTopicHubCandidates(
  locale: ArticleLocale,
): TopicHubArticle[] {
  return [
    ...getAllPosts(locale, "posts").map((article) => ({
      article,
      section: "posts" as const,
    })),
    ...getAllPosts(locale, "threat-intel").map((article) => ({
      article,
      section: "threat-intel" as const,
    })),
  ];
}

export function selectTopicHubArticles(
  hubSlug: string,
  candidates: TopicHubArticle[],
): TopicHubArticle[] {
  const hub = getTopicHubDefinition(hubSlug);
  if (!hub) return [];

  return candidates
    .filter(
      ({ article }) =>
        isPublicArticle(article) && matchesTopicHub(article.frontmatter, hub),
    )
    .sort(
      (a, b) =>
        new Date(b.article.frontmatter.date).getTime() -
        new Date(a.article.frontmatter.date).getTime(),
    );
}

export function isPublicTopicHub(
  hubSlug: string,
  candidates: TopicHubArticle[],
): boolean {
  return (
    selectTopicHubArticles(hubSlug, candidates).length >=
    PUBLIC_TOPIC_HUB_THRESHOLD
  );
}

export function getPublicTopicHubDefinitions(
  locale: ArticleLocale,
): TopicHubDefinition[] {
  const candidates = getTopicHubCandidates(locale);
  return TOPIC_HUBS.filter((hub) => isPublicTopicHub(hub.slug, candidates));
}

export function getArticleTopicHubLinks(
  frontmatter: ArticleFrontmatter,
): TopicHubDefinition[] {
  const slugs = [
    frontmatter.target_hub,
    ...(frontmatter.internal_link_targets ?? []),
  ];
  const seen = new Set<string>();
  const hubs: TopicHubDefinition[] = [];

  for (const rawSlug of slugs) {
    const hub = rawSlug ? getTopicHubDefinition(rawSlug) : undefined;
    if (!hub || seen.has(hub.slug)) continue;
    seen.add(hub.slug);
    hubs.push(hub);
  }

  return hubs;
}
