/**
 * Salary explorer — types, helpers, market metadata.
 *
 * Powers the /salary page. Data is sourced from zcyber-xhs's YAML topic
 * banks via the sync script (scripts/sync-career-data.ts) and committed
 * here as static JSON. Cross-project read happens at sync time, not
 * runtime — keeps git histories clean per repo (per portfolio rule in
 * ~/.claude/CLAUDE.md).
 */

import { z } from "zod";

// ── Source schema (matches xhs salary_map.yaml) ──────────────────────────

// `top_hiring` evolved in the source YAML to support TWO shapes:
//   - string[]                              (simple, most records)
//   - { label: string }[]                   (cross-market — labelled by region)
// We normalize to string[] at parse time so consumers see one shape.
const TopHiringEntry = z.union([
  z.string(),
  z.record(z.string(), z.string()).transform((obj) => {
    // {SG: "GovTech / Grab"} → "SG: GovTech / Grab"
    const entries = Object.entries(obj);
    return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
  }),
]);

export const SalaryRecordSchema = z.object({
  slug: z.string(),
  role: z.string(),
  market: z.string(),
  currency: z.string().min(2).max(8),
  entry_salary: z.string(),
  mid_salary: z.string(),
  senior_salary: z.string(),
  yoe_entry: z.string(),
  yoe_mid: z.string(),
  yoe_senior: z.string(),
  // Optional — some HK records include monthly breakdowns for transparency
  monthly_entry: z.string().optional(),
  monthly_mid: z.string().optional(),
  monthly_senior: z.string().optional(),
  top_hiring: z.array(TopHiringEntry).default([]),
  required_certs: z.array(z.string()).default([]),
  hook: z.string().optional(),
  shocking_fact: z.string().optional(),
  // Permissive — some sources are partial URLs or attribution strings.
  // Display layer will only render as a link if it parses as a URL.
  source_url: z.string().optional(),
  category: z.string().optional(),
  // ── Top-of-market / elite tier (optional) ────────────────────────────
  // Senior bands above describe the MEDIAN senior outcome — what most
  // 5-10 YoE professionals reach. `top_tier_*` is for outliers: regional
  // CISO, principal consultant, FAANG security lead, ex-Big4 partner.
  // Editorially separate so the median data stays accurate while we
  // surface the aspirational sticker-shock numbers that XHS readers ask
  // about ("但我朋友的 CISO 一年拿 200 万..."). Sourced from operator's
  // direct industry network for HK; conservative public-source estimates
  // for other markets where we have credible data.
  top_tier_salary: z.string().optional(),
  top_tier_note: z.string().optional(),
});
export type SalaryRecord = z.infer<typeof SalaryRecordSchema>;

export const CertRecordSchema = z.object({
  slug: z.string(),
  cert_a: z.string(),
  cert_b: z.string(),
  market: z.string(),
  market_note: z.string().optional(),
  angle: z.string().optional(),
  cert_a_cost_usd: z.number(),
  cert_a_cost_local: z.string(),
  cert_b_cost_usd: z.number(),
  cert_b_cost_local: z.string(),
  cert_a_salary_boost: z.string(),
  cert_b_salary_boost: z.string(),
  verdict: z.string(),
  verdict_reason: z.string(),
  category: z.string().optional(),
});
export type CertRecord = z.infer<typeof CertRecordSchema>;

// ── Display normalization ────────────────────────────────────────────────
// The source YAML has many overlapping market labels (e.g. "Singapore",
// "Singapore vs Hong Kong", "China T1 (北京/上海/深圳)"). For the UI we
// collapse them to a small set of canonical filter buckets.

export type MarketKey = "sg" | "my" | "cn-t1" | "cn-t2" | "au" | "hk" | "cross";

export const MARKETS: {
  key: MarketKey;
  en: string;
  zh: string;
  flag: string;
}[] = [
  { key: "sg", en: "Singapore", zh: "新加坡", flag: "🇸🇬" },
  { key: "my", en: "Malaysia", zh: "马来西亚", flag: "🇲🇾" },
  { key: "cn-t1", en: "China T1", zh: "中国一线", flag: "🇨🇳" },
  { key: "cn-t2", en: "China T2", zh: "中国二线", flag: "🇨🇳" },
  { key: "au", en: "Australia", zh: "澳大利亚", flag: "🇦🇺" },
  { key: "hk", en: "Hong Kong", zh: "香港", flag: "🇭🇰" },
  { key: "cross", en: "Cross-market", zh: "跨地区对比", flag: "🌐" },
];

/** Canonicalize the free-form `market` field from YAML to a MarketKey. */
export function classifyMarket(raw: string): MarketKey {
  const s = raw.toLowerCase();
  if (
    s.includes("singapore vs") ||
    s.includes("cross-market") ||
    s.includes("global comparison")
  ) {
    return "cross";
  }
  if (s.includes("hong kong") || s.startsWith("hk")) return "hk";
  if (s.includes("singapore")) return "sg";
  if (s.includes("malaysia") || s.includes("kuala lumpur") || s.includes("kl"))
    return "my";
  if (s.includes("china t2") || s.includes("二线")) return "cn-t2";
  if (
    s.includes("china t1") ||
    s.includes("china") ||
    s.includes("中国") ||
    s.includes("一线")
  )
    return "cn-t1";
  if (
    s.includes("australia") ||
    s.includes("sydney") ||
    s.includes("melbourne")
  )
    return "au";
  if (s.includes("remote")) return "cross";
  return "cross";
}

// ── Role canonicalization ────────────────────────────────────────────────
// Same idea — collapse the long-form roles into a small filter set.

export type RoleKey =
  | "soc"
  | "pentest"
  | "cloud"
  | "grc"
  | "architect"
  | "ciso"
  | "engineer"
  | "comparison";

export const ROLES: { key: RoleKey; en: string; zh: string }[] = [
  { key: "soc", en: "SOC Analyst", zh: "SOC 分析师" },
  { key: "pentest", en: "Penetration Tester", zh: "渗透测试" },
  { key: "cloud", en: "Cloud Security", zh: "云安全" },
  { key: "grc", en: "GRC Analyst", zh: "GRC 合规" },
  { key: "architect", en: "Security Architect", zh: "安全架构师" },
  { key: "ciso", en: "CISO", zh: "CISO" },
  { key: "engineer", en: "Security Engineer", zh: "安全工程师" },
  { key: "comparison", en: "Cross-role comparison", zh: "跨岗位对比" },
];

export function classifyRole(raw: string): RoleKey {
  const s = raw.toLowerCase();
  if (s.includes("ciso")) return "ciso";
  if (s.includes("cloud")) return "cloud";
  if (s.includes("grc")) return "grc";
  if (s.includes("architect")) return "architect";
  if (s.includes("pentest") || s.includes("penetration")) return "pentest";
  if (
    s.includes("soc") ||
    s.includes("security analyst") ||
    s.includes("entry level")
  )
    return "soc";
  if (s.includes("vs") || s.includes("comparison")) return "comparison";
  return "engineer";
}

// ── Currency formatting + USD conversion ─────────────────────────────────
// USD reference rates as of 2026-04-17. Used ONLY for cross-market
// comparison strip — primary salary display always uses source currency.
// Refresh quarterly with the YAML data.

export const USD_RATES: Record<string, number> = {
  USD: 1.0,
  SGD: 0.74,
  MYR: 0.22,
  CNY: 0.14,
  HKD: 0.13,
  AUD: 0.66,
};

/** Parse a salary range string like "42,000–60,000" → {low, high}. */
export function parseSalaryRange(
  s: string,
): { low: number; high: number } | null {
  // Handles en-dash (–), em-dash (—), hyphen (-), with optional commas
  const match = s.replace(/,/g, "").match(/(\d+)\s*[–—-]\s*(\d+)/);
  if (!match) return null;
  return { low: parseInt(match[1], 10), high: parseInt(match[2], 10) };
}

/** Convert local annual salary to USD (rounded to nearest $1k). */
export function toUsd(amount: number, currency: string): number {
  const rate = USD_RATES[currency.toUpperCase()] ?? 1;
  return Math.round((amount * rate) / 1000) * 1000;
}

/** Format a USD amount as "$120k" / "$1.2M". */
export function formatUsdShort(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`;
  return `$${usd}`;
}

/** Currency symbol lookup (display only, not arithmetic). */
export function currencySymbol(code: string): string {
  const map: Record<string, string> = {
    SGD: "S$",
    MYR: "RM",
    CNY: "¥",
    HKD: "HK$",
    AUD: "A$",
    USD: "$",
  };
  return map[code.toUpperCase()] ?? code;
}

// ── Filter helpers (used by server component to read URL params) ─────────

export function filterSalaries(
  records: SalaryRecord[],
  filters: { market?: MarketKey | "all"; role?: RoleKey | "all" },
): SalaryRecord[] {
  return records.filter((r) => {
    if (filters.market && filters.market !== "all") {
      if (classifyMarket(r.market) !== filters.market) return false;
    }
    if (filters.role && filters.role !== "all") {
      if (classifyRole(r.role) !== filters.role) return false;
    }
    return true;
  });
}
