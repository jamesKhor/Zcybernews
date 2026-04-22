import type { Article } from "@/lib/content";
import type { Locale } from "@/lib/resend";
import { scoreArticle } from "../../scripts/pipeline/quality-scorer";

interface DigestTemplateOptions {
  articles: Article[];
  locale: Locale;
  siteUrl: string;
  unsubscribeUrl: string;
}

const T = {
  en: {
    greeting: "Here's what's new on ZCyberNews",
    preheaderFallback: "Your daily cybersecurity intelligence briefing",
    readMore: "Read more",
    readHero: "Read the full analysis",
    footer:
      "You're receiving this because you subscribed to ZCyberNews daily digest.",
    unsubscribe: "Unsubscribe",
    viewOnline: "Browse all",
    viewOnlineSuffix: "articles",
    noArticles: "No new articles in this cycle.",
    moreArticles: "more article",
    moreArticlesPlural: "more articles",
    forwardCta: "Know a defender who'd find this useful? Forward this email.",
    discordCta: "Join our Discord community",
    topStory: "TOP STORY",
    todaysBriefing: "TODAY'S BRIEFING",
    communityTitle: "Join the conversation",
    replyCta: "💬 Hit reply — we read every response.",
    minRead: "min read",
  },
  zh: {
    greeting: "ZCyberNews 最新资讯",
    preheaderFallback: "每日网络安全情报简报",
    readMore: "阅读更多",
    readHero: "阅读完整分析",
    footer: "您收到此邮件是因为订阅了 ZCyberNews 每日摘要。",
    unsubscribe: "取消订阅",
    viewOnline: "浏览全部",
    viewOnlineSuffix: "篇文章",
    noArticles: "本时段暂无新文章。",
    moreArticles: "篇更多文章",
    moreArticlesPlural: "篇更多文章",
    forwardCta: "认识需要这些情报的安全从业者？转发此邮件。",
    discordCta: "加入 Discord 安全社区",
    topStory: "头条",
    todaysBriefing: "今日简报",
    communityTitle: "加入讨论",
    replyCta: "💬 直接回复此邮件，我们会认真阅读每一条反馈。",
    minRead: "分钟阅读",
  },
} as const;

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  informational: "#6b7280",
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

// ── v3: Category-specific pill colors ─────────────────────────────────────
// Each category gets its own tinted background + text color for instant
// visual differentiation. On light bg (secondary cards).

const CATEGORY_PILL: Record<
  string,
  { bg: string; color: string; border: string }
> = {
  "threat-intel": { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  vulnerabilities: { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  malware: { bg: "#fdf2f8", color: "#9d174d", border: "#fbcfe8" },
  industry: { bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
  tools: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  ai: { bg: "#faf5ff", color: "#7c3aed", border: "#e9d5ff" },
};

const DEFAULT_PILL = { bg: "#f5f5f5", color: "#525252", border: "#e5e5e5" };

// Category pills on dark hero bg — all use the same dark tinted style
const HERO_PILL = { bg: "#1e2a3a", color: "#22d3ee", border: "#2a3a4e" };

// ── Design tokens ─────────────────────────────────────────────────────────

const C = {
  bodyBg: "#f5f5f0",
  cardBg: "#ffffff",
  cardBorder: "#e5e5e5",
  cardRadius: "12px",
  textPrimary: "#1a1a1a",
  textSecondary: "#525252",
  textMuted: "#a3a3a3",
  brandPrimary: "#0891b2",
  brandAccent: "#ef4444",
  heroGradient:
    "linear-gradient(135deg, #0c1222 0%, #1a1a2e 50%, #0f172a 100%)",
  discord: "#5865F2",
  divider: "#e5e5e5",
  footerBg: "#eeedea",
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * Editorial serif stack for headlines (NYT-style gravitas).
 *
 * Email clients cannot reliably load custom web fonts (Gmail / Outlook
 * strip <link> and @font-face). We use a system serif fallback chain
 * that renders as a high-quality serif on every major client:
 *   - macOS / iOS: New York or Charter
 *   - Windows: Sitka Text, Cambria, Georgia
 *   - Android / Linux: Noto Serif, Georgia
 *   - Universal fallback: Georgia (on every platform since 1993)
 *
 * Used only on the digest hero H2 and secondary H3 titles — matches
 * the site's Source Serif 4 editorial voice without requiring a
 * network font load. Sans-serif (FONT above) remains for eyebrows,
 * badges, badges, body, and CTAs — the NYT convention.
 */
const SERIF_FONT =
  "'New York', 'Charter', 'Sitka Text', 'Cambria', Georgia, 'Noto Serif', serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Estimate reading time from word count (same logic as lib/content.ts) */
function estimateReadingTime(article: Article): number {
  // articles have readingTime from content.ts; use it if available, else estimate
  return (
    article.readingTime ?? Math.ceil(article.content.split(/\s+/).length / 200)
  );
}

// ── Content strategy ──────────────────────────────────────────────────────

const MAX_ARTICLES = 7;
const MIN_ARTICLES_TO_SEND = 3;

/**
 * Quality-weighted HERO selection (2026-04-23).
 *
 * The previous implementation sorted by frontmatter.severity only, so
 * an article marked `severity: critical` with ZERO structured fields +
 * word count below floor could still become the hero. With 2 real
 * subscribers, that's unacceptable — the hero is the ONE article the
 * subscriber's eye lands on first.
 *
 * New rule:
 *   HERO MUST have a quality headlineScore ≥ 7.0 OR have
 *   structuredRichness ≥ 3. If no candidate qualifies for HERO, we
 *   fall back to the best-scoring article regardless (rather than
 *   emit no hero), but that case is exceptional — the upstream digest
 *   runner already filters SERIOUS-flagged articles, so remaining
 *   candidates are at worst WARN-level.
 *
 * Secondary articles still use the severity+category sort for
 * chronological/editorial ordering.
 */
const HERO_MIN_QUALITY_SCORE = 7.0;
const HERO_MIN_STRUCTURED_RICHNESS = 3;

function selectArticles(
  articles: Article[],
  locale: Locale = "en",
): {
  hero: Article | null;
  secondary: Article[];
  remainingCount: number;
} {
  if (articles.length === 0) {
    return { hero: null, secondary: [], remainingCount: 0 };
  }

  // Attach quality scores once so sort comparators don't recompute.
  type Scored = { article: Article; q: ReturnType<typeof scoreArticle> };
  const scored: Scored[] = articles.map((a) => ({
    article: a,
    q: scoreArticle({
      slug: a.frontmatter.slug,
      locale,
      // Section lookup isn't fully accurate here (Article doesn't carry
      // its source dir), but category-based floor in scoreArticle is
      // the primary driver. Using "posts" as default is safe.
      section: "posts",
      frontmatter: a.frontmatter,
      body: a.content,
    }),
  }));

  // HERO: pick the best-quality story that meets the minimum bar.
  // Among qualifying candidates, prefer critical severity + threat-
  // intel category as a tiebreaker (the existing editorial weight).
  const heroCandidates = scored.filter(
    (s) =>
      s.q.headlineScore >= HERO_MIN_QUALITY_SCORE ||
      s.q.structuredRichness >= HERO_MIN_STRUCTURED_RICHNESS,
  );
  const heroRanking = (heroCandidates.length > 0 ? heroCandidates : scored)
    .slice()
    .sort((a, b) => {
      if (b.q.headlineScore !== a.q.headlineScore)
        return b.q.headlineScore - a.q.headlineScore;
      const sevA = SEVERITY_RANK[a.article.frontmatter.severity ?? ""] ?? 0;
      const sevB = SEVERITY_RANK[b.article.frontmatter.severity ?? ""] ?? 0;
      if (sevB !== sevA) return sevB - sevA;
      const aIsTI = a.article.frontmatter.category === "threat-intel";
      const bIsTI = b.article.frontmatter.category === "threat-intel";
      if (aIsTI !== bIsTI) return aIsTI ? -1 : 1;
      return a.article.frontmatter.title.localeCompare(
        b.article.frontmatter.title,
      );
    });
  const hero = heroRanking[0]?.article ?? null;

  // Secondary: original severity+category+title sort, excluding hero.
  const secondarySorted = scored
    .filter((s) => s.article !== hero)
    .sort((a, b) => {
      const sevA = SEVERITY_RANK[a.article.frontmatter.severity ?? ""] ?? 0;
      const sevB = SEVERITY_RANK[b.article.frontmatter.severity ?? ""] ?? 0;
      if (sevB !== sevA) return sevB - sevA;
      const aIsTI = a.article.frontmatter.category === "threat-intel";
      const bIsTI = b.article.frontmatter.category === "threat-intel";
      if (aIsTI !== bIsTI) return aIsTI ? -1 : 1;
      return a.article.frontmatter.title.localeCompare(
        b.article.frontmatter.title,
      );
    })
    .slice(0, MAX_ARTICLES - 1)
    .map((s) => s.article);

  const remainingCount = Math.max(0, articles.length - MAX_ARTICLES);
  return { hero, secondary: secondarySorted, remainingCount };
}

// ── Subject line ──────────────────────────────────────────────────────────

export function buildDigestSubject(
  articles: Article[],
  locale: Locale,
): string {
  const count = articles.length;
  const dateStr = new Date().toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { month: "short", day: "numeric" },
  );

  const { hero } = selectArticles(articles, locale);
  const heroTitle = hero
    ? hero.frontmatter.title.length > 50
      ? hero.frontmatter.title.slice(0, 47) + "..."
      : hero.frontmatter.title
    : "";
  const otherCount = count - 1;

  if (locale === "zh") {
    if (heroTitle && otherCount > 0) {
      return `${heroTitle} + ${otherCount}篇 · ${dateStr}`;
    }
    return `ZCyberNews 摘要 · ${dateStr} · ${count} 篇新文章`;
  }

  if (heroTitle && otherCount > 0) {
    return `${heroTitle} + ${otherCount} more · ${dateStr}`;
  }
  return `ZCyberNews Digest · ${dateStr} · ${count} new article${count === 1 ? "" : "s"}`;
}

// ── Main template ─────────────────────────────────────────────────────────

export function buildDigestHtml({
  articles,
  locale,
  siteUrl,
  unsubscribeUrl,
}: DigestTemplateOptions): string {
  const t = T[locale];
  const totalCount = articles.length;
  const { hero, secondary, remainingCount } = selectArticles(articles, locale);
  const discordUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? "";

  const preheaderText = hero
    ? escapeHtml(hero.frontmatter.title)
    : escapeHtml(t.preheaderFallback);

  const dateBadge = new Date().toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );

  const heroBlock = hero ? renderHeroBlock(hero, locale, siteUrl, t) : "";

  const secondaryBlocks = secondary
    .map((a) => renderSecondaryBlock(a, locale, siteUrl, t))
    .join("\n");

  const moreBlock =
    remainingCount > 0
      ? `<tr>
          <td style="padding:4px 32px 16px;text-align:center;">
            <a href="${siteUrl}/${locale}/articles" style="color:${C.brandPrimary};text-decoration:none;font-size:14px;font-weight:500;font-family:${FONT};">
              + ${remainingCount} ${remainingCount === 1 ? escapeHtml(t.moreArticles) : escapeHtml(t.moreArticlesPlural)} →
            </a>
          </td>
        </tr>`
      : "";

  // Community card — Discord + forward CTA + reply CTA
  const communityInner = `
    <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:${C.textPrimary};font-family:${FONT};">${escapeHtml(t.communityTitle)}</p>
    ${discordUrl ? `<a href="${escapeHtml(discordUrl)}" style="display:inline-block;padding:10px 20px;background:${C.discord};color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;font-family:${FONT};">${escapeHtml(t.discordCta)} →</a>` : ""}
    <p style="margin:${discordUrl ? "14px" : "0"} 0 0;color:${C.textMuted};font-size:12px;font-style:italic;font-family:${FONT};">${escapeHtml(t.forwardCta)}</p>
  `;

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(buildDigestSubject(articles, locale))}</title>
</head>
<body style="margin:0;padding:0;background:${C.bodyBg};font-family:${FONT};color:${C.textPrimary};">
  <!--[if mso]><span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;">${preheaderText}</span><![endif]-->
  <span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;visibility:hidden;">${preheaderText}${"‌".repeat(60)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bodyBg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:${C.cardRadius};overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <a href="${siteUrl}/${locale}" style="text-decoration:none;">
                      <span style="font-size:24px;font-weight:700;font-family:${FONT};letter-spacing:-0.02em;">
                        <span style="color:${C.brandAccent};">Z</span><span style="color:${C.brandPrimary};">CyberNews</span>
                      </span>
                    </a>
                    <p style="margin:6px 0 0;color:${C.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-family:${FONT};">${escapeHtml(t.todaysBriefing)}</p>
                  </td>
                  <td style="text-align:right;vertical-align:top;">
                    <span style="display:inline-block;padding:6px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:20px;font-size:12px;font-weight:600;color:${C.brandPrimary};font-family:${FONT};">${escapeHtml(dateBadge)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero article (dark banner) -->
          ${heroBlock}

          <!-- Secondary articles (white cards with severity accent) -->
          <tr>
            <td style="padding:20px 24px 8px;">
              ${secondaryBlocks || `<p style="color:${C.textMuted};font-size:14px;font-family:${FONT};">${escapeHtml(t.noArticles)}</p>`}
            </td>
          </tr>

          <!-- More articles link -->
          ${moreBlock}

          <!-- Primary CTA -->
          <tr>
            <td style="padding:8px 32px 24px;text-align:center;">
              <a href="${siteUrl}/${locale}/articles" style="display:inline-block;padding:12px 28px;background:${C.brandPrimary};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;font-family:${FONT};">${escapeHtml(t.viewOnline)} ${totalCount} ${escapeHtml(t.viewOnlineSuffix)} →</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="border-top:1px solid ${C.divider};"></div>
            </td>
          </tr>

          <!-- Community card -->
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.cardBorder};border-radius:${C.cardRadius};overflow:hidden;">
                <tr>
                  <td style="padding:20px 24px;text-align:center;background:${C.cardBg};">
                    ${communityInner}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reply CTA -->
          <tr>
            <td style="padding:0 32px 20px;text-align:center;">
              <p style="margin:0;color:${C.textSecondary};font-size:13px;font-family:${FONT};">${t.replyCta}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:${C.footerBg};border-top:1px solid ${C.divider};">
              <p style="margin:0 0 6px;color:${C.textMuted};font-size:11px;line-height:1.5;font-family:${FONT};">${escapeHtml(t.footer)}</p>
              <p style="margin:0;color:${C.textMuted};font-size:11px;font-family:${FONT};">
                <a href="${unsubscribeUrl}" style="color:${C.brandPrimary};">${escapeHtml(t.unsubscribe)}</a>
                &nbsp;·&nbsp;
                <a href="${siteUrl}/${locale}" style="color:${C.brandPrimary};">zcybernews.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Hero block (DARK — contrast punch) ────────────────────────────────────

function renderHeroBlock(
  a: Article,
  locale: Locale,
  siteUrl: string,
  t: (typeof T)[Locale],
): string {
  const fm = a.frontmatter;
  const url = `${siteUrl}/${locale}/${fm.category === "threat-intel" ? "threat-intel" : "articles"}/${fm.slug}`;
  const severity = fm.severity;
  const readTime = estimateReadingTime(a);

  const severityBadge = severity
    ? `<span style="display:inline-block;padding:4px 10px;background:${SEVERITY_COLOR[severity] ?? "#6b7280"};color:#fff;font-size:11px;font-weight:700;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;font-family:${FONT};">${escapeHtml(severity)}</span>`
    : "";
  const categoryBadge = `<span style="display:inline-block;padding:4px 10px;background:${HERO_PILL.bg};color:${HERO_PILL.color};font-size:11px;font-weight:600;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;border:1px solid ${HERO_PILL.border};font-family:${FONT};">${escapeHtml(fm.category)}</span>`;
  const readTimeBadge = `<span style="display:inline-block;padding:4px 10px;background:rgba(255,255,255,0.08);color:#a1a1aa;font-size:11px;font-weight:500;border-radius:6px;font-family:${FONT};">⏱ ${readTime} ${escapeHtml(t.minRead)}</span>`;

  const heroExcerpt =
    fm.excerpt.length > 160 ? fm.excerpt.slice(0, 157) + "..." : fm.excerpt;

  return `<tr>
    <td style="padding:0;">
      <!-- Accent bar -->
      <div style="height:4px;background:linear-gradient(90deg, ${C.brandAccent} 0%, ${C.brandPrimary} 100%);"></div>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 32px 24px;background:${C.heroGradient};">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
        <v:fill type="gradient" color="#0c1222" color2="#0f172a" angle="135"/>
        <v:textbox style="mso-fit-shape-to-text:true" inset="28px,28px,28px,24px">
      <![endif]-->
      <p style="margin:0 0 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${C.brandAccent};font-family:${FONT};">▎${escapeHtml(t.topStory)}</p>
      <div style="margin-bottom:14px;">${categoryBadge}&nbsp;&nbsp;${severityBadge}&nbsp;&nbsp;${readTimeBadge}</div>
      <a href="${url}" style="text-decoration:none;">
        <h2 style="margin:0 0 14px;color:#ffffff;font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-0.015em;font-family:${SERIF_FONT};">${escapeHtml(fm.title)}</h2>
      </a>
      <p style="margin:0 0 20px;color:#d4d4d8;font-size:15px;line-height:1.55;font-family:${FONT};">${escapeHtml(heroExcerpt)}</p>
      <a href="${url}" style="display:inline-block;padding:10px 22px;background:${C.brandPrimary};color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;font-family:${FONT};">${escapeHtml(t.readHero)} →</a>
      <!--[if gte mso 9]>
        </v:textbox>
      </v:rect>
      <![endif]-->
    </td>
  </tr>`;
}

// ── Secondary article card (WHITE with severity left-border accent) ───────

function renderSecondaryBlock(
  a: Article,
  locale: Locale,
  siteUrl: string,
  t: (typeof T)[Locale],
): string {
  const fm = a.frontmatter;
  const url = `${siteUrl}/${locale}/${fm.category === "threat-intel" ? "threat-intel" : "articles"}/${fm.slug}`;
  const severity = fm.severity;
  const readTime = estimateReadingTime(a);
  const accentColor = SEVERITY_COLOR[severity ?? ""] ?? C.cardBorder;
  const pill = CATEGORY_PILL[fm.category] ?? DEFAULT_PILL;

  const severityBadge = severity
    ? `<span style="display:inline-block;padding:3px 8px;background:${SEVERITY_COLOR[severity] ?? "#6b7280"};color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;font-family:${FONT};">${escapeHtml(severity)}</span>`
    : "";
  const categoryBadge = `<span style="display:inline-block;padding:3px 8px;background:${pill.bg};color:${pill.color};font-size:10px;font-weight:600;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;border:1px solid ${pill.border};font-family:${FONT};">${escapeHtml(fm.category)}</span>`;
  const readTimeBadge = `<span style="color:${C.textMuted};font-size:11px;font-family:${FONT};">⏱ ${readTime} ${escapeHtml(t.minRead)}</span>`;

  const excerpt =
    fm.excerpt.length > 140 ? fm.excerpt.slice(0, 137) + "..." : fm.excerpt;

  // Table-based card with left border accent colored by severity
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid ${C.cardBorder};border-radius:${C.cardRadius};overflow:hidden;">
  <tr>
    <td style="width:4px;background:${accentColor};font-size:0;line-height:0;" width="4">&nbsp;</td>
    <td style="padding:16px 20px;background:${C.cardBg};">
      <div style="margin-bottom:8px;">${categoryBadge}&nbsp;&nbsp;${severityBadge}&nbsp;&nbsp;${readTimeBadge}</div>
      <a href="${url}" style="text-decoration:none;">
        <h3 style="margin:0 0 6px;color:${C.textPrimary};font-size:17px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;font-family:${SERIF_FONT};">${escapeHtml(fm.title)}</h3>
      </a>
      <p style="margin:0 0 8px;color:${C.textSecondary};font-size:14px;line-height:1.5;font-family:${FONT};">${escapeHtml(excerpt)}</p>
      <a href="${url}" style="color:${C.brandPrimary};text-decoration:none;font-size:12px;font-weight:500;font-family:${FONT};">${escapeHtml(t.readMore)} →</a>
    </td>
  </tr>
</table>`;
}

export { MIN_ARTICLES_TO_SEND, MAX_ARTICLES, selectArticles };
