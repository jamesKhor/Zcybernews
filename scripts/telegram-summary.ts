#!/usr/bin/env tsx
/**
 * Rich Telegram summaries for the operator.
 *
 * Cadences:
 *   daily   — recent publishing, notable stories, immediate action items
 *   weekly  — trend, quality, source health, operating priorities
 *   monthly — strategic rollup: volume, mix, quality debt, cost posture
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

type Cadence = "daily" | "weekly" | "monthly";
type Section = "posts" | "threat-intel";
type Locale = "en" | "zh";

interface ArticleMeta {
  locale: Locale;
  section: Section;
  title: string;
  slug: string;
  date: string;
  category: string;
  tags: string[];
  excerpt: string;
  severity?: string;
  cveIds: string[];
  threatActor?: string;
  affectedSectors: string[];
  affectedRegions: string[];
}

interface CountItem {
  value: string;
  count: number;
}

interface SummaryData {
  cadence: Cadence;
  windowHours: number;
  articles: ArticleMeta[];
  recentEn: ArticleMeta[];
  topCategories: CountItem[];
  topTags: CountItem[];
  topSectors: CountItem[];
  topRegions: CountItem[];
  notable: ArticleMeta[];
  quality: {
    seriousCount: number;
    warnCount: number;
    avgHeadlineScore: number | null;
    avgWordCount: number | null;
    topFlags: CountItem[];
  } | null;
  feedProblems: string[];
  analytics: {
    total: number;
    published7d: number;
    published30d: number;
    parityRatio: string;
    missingZh: number;
  } | null;
  budget: {
    projectedCost: number | null;
    costPerArticle: number | null;
    projectedArticles: number | null;
  } | null;
  actions: string[];
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CADENCE: Cadence = parseCadence(
  args.find((arg) => arg.startsWith("--cadence="))?.split("=")[1],
);
const WINDOW_HOURS = Number(
  args.find((arg) => arg.startsWith("--window-hours="))?.split("=")[1] ??
    defaultWindowHours(CADENCE),
);

function parseCadence(raw: string | undefined): Cadence {
  if (raw === "weekly" || raw === "monthly" || raw === "daily") return raw;
  return "daily";
}

function defaultWindowHours(cadence: Cadence): number {
  if (cadence === "monthly") return 24 * 30;
  if (cadence === "weekly") return 24 * 7;
  return 24;
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function parseDateMs(value: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59Z`
    : value;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function listArticles(): ArticleMeta[] {
  const roots: Array<{ locale: Locale; section: Section; dir: string }> = [
    { locale: "en", section: "posts", dir: "content/en/posts" },
    { locale: "en", section: "threat-intel", dir: "content/en/threat-intel" },
    { locale: "zh", section: "posts", dir: "content/zh/posts" },
    { locale: "zh", section: "threat-intel", dir: "content/zh/threat-intel" },
  ];
  const out: ArticleMeta[] = [];

  for (const root of roots) {
    const dir = path.join(process.cwd(), root.dir);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"))) {
      try {
        const parsed = matter(fs.readFileSync(path.join(dir, file), "utf-8"));
        const data = parsed.data;
        if (data.draft) continue;
        out.push({
          locale: root.locale,
          section: root.section,
          title: String(data.title ?? path.basename(file, ".mdx")),
          slug: String(data.slug ?? path.basename(file, ".mdx")),
          date: String(data.date ?? ""),
          category: String(data.category ?? "uncategorized"),
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
          excerpt: String(data.excerpt ?? ""),
          severity: data.severity ? String(data.severity) : undefined,
          cveIds: Array.isArray(data.cve_ids) ? data.cve_ids.map(String) : [],
          threatActor: data.threat_actor
            ? String(data.threat_actor)
            : undefined,
          affectedSectors: Array.isArray(data.affected_sectors)
            ? data.affected_sectors.map(String)
            : [],
          affectedRegions: Array.isArray(data.affected_regions)
            ? data.affected_regions.map(String)
            : [],
        });
      } catch {
        // Skip malformed content; the summary should still arrive.
      }
    }
  }

  return out;
}

function topN(values: string[], limit: number): CountItem[] {
  const counts = new Map<string, number>();
  for (const rawValue of values.filter(Boolean)) {
    const value = rawValue.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function normalizeDimension(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.toLowerCase() === "global") return "Global";
  return normalized;
}

function scoreNotability(article: ArticleMeta): number {
  let score = 0;
  if (article.severity === "critical") score += 10;
  if (article.severity === "high") score += 6;
  if (article.cveIds.length > 0) score += 5;
  if (article.threatActor) score += 4;
  if (article.section === "threat-intel") score += 3;
  if (article.category === "vulnerabilities") score += 3;
  score += Math.min(article.tags.length, 5);
  return score;
}

type QualityFile = {
  summary?: {
    seriousCount?: number;
    warnCount?: number;
    avgHeadlineScore?: number;
    avgWordCount?: number;
    topFlagCodes?: Array<{ code: string; count: number }>;
  };
};

function loadQuality() {
  const quality = readJson<QualityFile>("data/quality-daily.json");
  const summary = quality?.summary;
  if (!summary) return null;
  return {
    seriousCount: summary.seriousCount ?? 0,
    warnCount: summary.warnCount ?? 0,
    avgHeadlineScore: summary.avgHeadlineScore ?? null,
    avgWordCount: summary.avgWordCount ?? null,
    topFlags:
      summary.topFlagCodes?.slice(0, 5).map((flag) => ({
        value: flag.code,
        count: flag.count,
      })) ?? [],
  };
}

type FeedHealthFile = Record<
  string,
  { lastSuccess?: string; consecutiveFailures?: number }
>;
type FeedSourceFile = Array<{ id?: string; enabled?: boolean }>;

function loadEnabledSourceIds(): Set<string> | null {
  const sources = readJson<FeedSourceFile>("data/rss-sources.json");
  if (!Array.isArray(sources)) return null;
  return new Set(
    sources
      .filter((source) => source.enabled !== false && source.id)
      .map((source) => String(source.id)),
  );
}

function loadFeedProblems(now = Date.now()): string[] {
  const health = readJson<FeedHealthFile>("data/feed-health.json");
  if (!health) return [];
  const enabledSourceIds = loadEnabledSourceIds();
  return Object.entries(health)
    .filter(([name]) => !enabledSourceIds || enabledSourceIds.has(name))
    .flatMap(([name, item]) => {
      const failures = item.consecutiveFailures ?? 0;
      const lastSuccessMs = item.lastSuccess
        ? new Date(item.lastSuccess).getTime()
        : 0;
      const staleHours = lastSuccessMs
        ? Math.round((now - lastSuccessMs) / 36e5)
        : null;
      if (failures >= 3) return [`${name}: ${failures} consecutive failures`];
      if (staleHours !== null && staleHours > 36) {
        return [`${name}: last success ${staleHours}h ago`];
      }
      return [];
    })
    .slice(0, 8);
}

type AnalyticsSnapshot = {
  totals?: { total?: number };
  published_in_last?: { "7d"?: number; "30d"?: number };
  translation_parity?: { parity_ratio?: string; missing_zh?: number };
};

function loadAnalytics() {
  const history = readJson<AnalyticsSnapshot[]>("data/analytics-daily.json");
  const latest = Array.isArray(history) ? history.at(-1) : null;
  if (!latest) return null;
  return {
    total: latest.totals?.total ?? 0,
    published7d: latest.published_in_last?.["7d"] ?? 0,
    published30d: latest.published_in_last?.["30d"] ?? 0,
    parityRatio: latest.translation_parity?.parity_ratio ?? "n/a",
    missingZh: latest.translation_parity?.missing_zh ?? 0,
  };
}

type BudgetSnapshot = {
  month_to_date?: { cost_per_article_usd?: number };
  projection_full_month?: { total_cost_usd?: number; articles?: number };
};

function loadBudget() {
  const history = readJson<BudgetSnapshot[]>("data/budget-daily.json");
  const latest = Array.isArray(history) ? history.at(-1) : null;
  if (!latest) return null;
  return {
    projectedCost: latest.projection_full_month?.total_cost_usd ?? null,
    costPerArticle: latest.month_to_date?.cost_per_article_usd ?? null,
    projectedArticles: latest.projection_full_month?.articles ?? null,
  };
}

function buildActions(data: Omit<SummaryData, "actions">): string[] {
  const actions: string[] = [];
  if (data.feedProblems.length > 0) {
    actions.push(`Check ${data.feedProblems.length} unhealthy feed source(s).`);
  }
  if ((data.quality?.seriousCount ?? 0) > 0) {
    actions.push(
      `Review quality debt: ${data.quality!.seriousCount} serious article flag(s).`,
    );
  }
  if ((data.analytics?.missingZh ?? 0) > 0) {
    actions.push(
      `Backfill ${data.analytics!.missingZh} missing ZH counterpart(s).`,
    );
  }
  if (data.recentEn.length === 0 && data.cadence === "daily") {
    actions.push(
      "No EN articles in the daily window; confirm pipeline cadence.",
    );
  }
  if (data.notable.some((article) => article.severity === "critical")) {
    actions.push("Consider manually sharing critical-severity coverage.");
  }
  return actions.slice(0, 5);
}

export function buildSummaryData(
  cadence: Cadence,
  windowHours: number,
): SummaryData {
  const articles = listArticles();
  const cutoff = Date.now() - windowHours * 36e5;
  const recentEn = articles
    .filter(
      (article) =>
        article.locale === "en" && parseDateMs(article.date) >= cutoff,
    )
    .sort((a, b) => parseDateMs(b.date) - parseDateMs(a.date));

  const base = {
    cadence,
    windowHours,
    articles,
    recentEn,
    topCategories: topN(
      recentEn.map((article) => article.category),
      6,
    ),
    topTags: topN(
      recentEn.flatMap((article) => article.tags),
      8,
    ),
    topSectors: topN(
      recentEn
        .flatMap((article) => article.affectedSectors)
        .map(normalizeDimension),
      5,
    ),
    topRegions: topN(
      recentEn
        .flatMap((article) => article.affectedRegions)
        .map(normalizeDimension),
      5,
    ),
    notable: [...recentEn]
      .sort((a, b) => scoreNotability(b) - scoreNotability(a))
      .slice(0, cadence === "daily" ? 5 : 8),
    quality: loadQuality(),
    feedProblems: loadFeedProblems(),
    analytics: loadAnalytics(),
    budget: loadBudget(),
  };

  return {
    ...base,
    actions: buildActions(base),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function compactList(items: CountItem[], fallback = "none"): string {
  if (items.length === 0) return fallback;
  return items
    .map((item) => `${escapeHtml(item.value)} ${item.count}`)
    .join(" · ");
}

function articleLine(article: ArticleMeta): string {
  const signals = [
    article.severity,
    article.cveIds.slice(0, 2).join(", "),
    article.threatActor,
    article.category,
  ].filter(Boolean);
  return `• <b>${escapeHtml(article.title)}</b>\n  ${escapeHtml(signals.join(" · ") || article.excerpt.slice(0, 120))}`;
}

export function renderTelegramSummary(data: SummaryData): string {
  const period =
    data.cadence === "monthly"
      ? "Monthly"
      : data.cadence === "weekly"
        ? "Weekly"
        : "Daily";
  const lines: string[] = [];
  lines.push(`<b>ZCyberNews ${period} Intelligence Brief</b>`);
  lines.push(`Window: ${Math.round(data.windowHours / 24)}d`);
  lines.push("");
  lines.push("<b>Publishing</b>");
  lines.push(`• EN articles in window: ${data.recentEn.length}`);
  if (data.analytics) {
    lines.push(
      `• Corpus: ${data.analytics.total} total · 7d ${data.analytics.published7d} · 30d ${data.analytics.published30d}`,
    );
    lines.push(
      `• Translation parity: ${data.analytics.parityRatio} (${data.analytics.missingZh} missing ZH)`,
    );
  }
  lines.push(`• Categories: ${compactList(data.topCategories)}`);
  lines.push(`• Tags: ${compactList(data.topTags)}`);
  if (data.topSectors.length > 0) {
    lines.push(`• Sectors: ${compactList(data.topSectors)}`);
  }
  if (data.topRegions.length > 0) {
    lines.push(`• Regions: ${compactList(data.topRegions)}`);
  }
  lines.push("");
  lines.push("<b>Notable Coverage</b>");
  if (data.notable.length === 0) {
    lines.push("• No notable articles in this window.");
  } else {
    lines.push(...data.notable.map(articleLine));
  }
  lines.push("");
  lines.push("<b>Quality & Ops</b>");
  if (data.quality) {
    lines.push(
      `• Quality: ${data.quality.seriousCount} serious · ${data.quality.warnCount} warn · headline avg ${data.quality.avgHeadlineScore ?? "n/a"} · words avg ${data.quality.avgWordCount ?? "n/a"}`,
    );
    lines.push(`• Top flags: ${compactList(data.quality.topFlags)}`);
  } else {
    lines.push("• Quality: no audit snapshot found.");
  }
  lines.push(
    `• Feed health: ${
      data.feedProblems.length === 0
        ? "all monitored sources healthy"
        : data.feedProblems.map(escapeHtml).join(" · ")
    }`,
  );
  if (data.budget) {
    lines.push(
      `• Cost projection: $${data.budget.projectedCost ?? "n/a"} · ${data.budget.projectedArticles ?? "n/a"} articles · $${data.budget.costPerArticle ?? "n/a"}/article`,
    );
  }
  lines.push("");
  lines.push("<b>Suggested Actions</b>");
  if (data.actions.length === 0) {
    lines.push("• No immediate action items.");
  } else {
    lines.push(...data.actions.map((action) => `• ${escapeHtml(action)}`));
  }
  return lines.join("\n");
}

export function chunkTelegramMessage(text: string, maxLength = 3900): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);
    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    let remaining = line;
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf(" ", maxLength);
      if (splitAt < Math.floor(maxLength * 0.7)) splitAt = maxLength;
      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();
    }
    current = remaining;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or use --dry-run)",
    );
  }
  for (const chunk of chunkTelegramMessage(text)) {
    const params = new URLSearchParams({
      chat_id: chatId,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
      text: chunk,
    });
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  const summary = buildSummaryData(CADENCE, WINDOW_HOURS);
  const message = renderTelegramSummary(summary);
  console.log(message);
  console.log(
    JSON.stringify({
      event: "telegram_summary",
      cadence: CADENCE,
      windowHours: WINDOW_HOURS,
      recentArticles: summary.recentEn.length,
      actions: summary.actions.length,
      timestamp: new Date().toISOString(),
    }),
  );
  if (!DRY_RUN) await sendTelegram(message);
}

if (
  process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/telegram-summary.ts")
) {
  main().catch((err) => {
    console.error("[telegram-summary] failed:", err);
    process.exit(1);
  });
}
