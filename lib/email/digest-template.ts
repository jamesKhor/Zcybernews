import type { Article } from "@/lib/content";
import type { Locale } from "@/lib/resend";

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
    severityLabel: "Severity",
    noArticles: "No new articles in this cycle.",
    moreArticles: "more article",
    moreArticlesPlural: "more articles",
    forwardCta: "Know a defender who'd find this useful? Forward this email.",
    discordCta: "Join our Discord community",
    topStory: "TOP STORY",
    todaysBriefing: "TODAY'S BRIEFING",
    communityTitle: "Join the conversation",
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
    severityLabel: "严重程度",
    noArticles: "本时段暂无新文章。",
    moreArticles: "篇更多文章",
    moreArticlesPlural: "篇更多文章",
    forwardCta: "认识需要这些情报的安全从业者？转发此邮件。",
    discordCta: "加入 Discord 安全社区",
    topStory: "头条",
    todaysBriefing: "今日简报",
    communityTitle: "加入讨论",
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

// ── Design tokens ─────────────────────────────────────────────────────────
// Centralized palette inspired by Perplexity (clean cards), Google Dev
// (dark hero banner), and Claude Code (warm off-white, rounded cards).

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
  heroBadgeBg: "#1e2a3a",
  discord: "#5865F2",
  divider: "#e5e5e5",
  footerBg: "#eeedea",
  pillBg: "#f0f9ff",
  pillBorder: "#e0e7ef",
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Content strategy ──────────────────────────────────────────────────────

const MAX_ARTICLES = 7;
const MIN_ARTICLES_TO_SEND = 3;

function selectArticles(articles: Article[]): {
  hero: Article | null;
  secondary: Article[];
  remainingCount: number;
} {
  if (articles.length === 0) {
    return { hero: null, secondary: [], remainingCount: 0 };
  }

  const sorted = [...articles].sort((a, b) => {
    const sevA = SEVERITY_RANK[a.frontmatter.severity ?? ""] ?? 0;
    const sevB = SEVERITY_RANK[b.frontmatter.severity ?? ""] ?? 0;
    if (sevB !== sevA) return sevB - sevA;
    if (
      a.frontmatter.category === "threat-intel" &&
      b.frontmatter.category !== "threat-intel"
    )
      return -1;
    if (
      b.frontmatter.category === "threat-intel" &&
      a.frontmatter.category !== "threat-intel"
    )
      return 1;
    return a.frontmatter.title.localeCompare(b.frontmatter.title);
  });

  const hero = sorted[0] ?? null;
  const secondary = sorted.slice(1, MAX_ARTICLES);
  const remainingCount = Math.max(0, articles.length - MAX_ARTICLES);

  return { hero, secondary, remainingCount };
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
  if (locale === "zh") {
    return `ZCyberNews 摘要 · ${dateStr} · ${count} 篇新文章`;
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
  const { hero, secondary, remainingCount } = selectArticles(articles);
  const discordUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? "";

  const preheaderText = hero
    ? escapeHtml(hero.frontmatter.title)
    : escapeHtml(t.preheaderFallback);

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

  // Community card — Discord + forward CTA merged into one bordered card
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
              <a href="${siteUrl}/${locale}" style="text-decoration:none;">
                <span style="font-size:24px;font-weight:700;font-family:${FONT};letter-spacing:-0.02em;">
                  <span style="color:${C.brandAccent};">Z</span><span style="color:${C.brandPrimary};">CyberNews</span>
                </span>
              </a>
              <p style="margin:6px 0 0;color:${C.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-family:${FONT};">${escapeHtml(t.todaysBriefing)}</p>
            </td>
          </tr>

          <!-- Hero article (dark banner — the ONE dark section) -->
          ${heroBlock}

          <!-- Secondary articles (white cards) -->
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
  const severityBadge = severity
    ? `<span style="display:inline-block;padding:4px 10px;background:${SEVERITY_COLOR[severity] ?? "#6b7280"};color:#fff;font-size:11px;font-weight:700;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;font-family:${FONT};">${escapeHtml(severity)}</span>`
    : "";
  const categoryBadge = `<span style="display:inline-block;padding:4px 10px;background:${C.heroBadgeBg};color:#22d3ee;font-size:11px;font-weight:600;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;border:1px solid #2a3a4e;font-family:${FONT};">${escapeHtml(fm.category)}</span>`;

  return `<tr>
    <td style="padding:28px 32px 24px;background:${C.heroGradient};">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
        <v:fill type="gradient" color="#0c1222" color2="#0f172a" angle="135"/>
        <v:textbox style="mso-fit-shape-to-text:true" inset="28px,28px,28px,24px">
      <![endif]-->
      <p style="margin:0 0 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:${C.brandAccent};font-family:${FONT};">▎${escapeHtml(t.topStory)}</p>
      <div style="margin-bottom:12px;">${categoryBadge}&nbsp;&nbsp;${severityBadge}</div>
      <a href="${url}" style="text-decoration:none;">
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:22px;line-height:1.3;font-weight:700;font-family:${FONT};">${escapeHtml(fm.title)}</h2>
      </a>
      <p style="margin:0 0 18px;color:#d4d4d8;font-size:15px;line-height:1.55;font-family:${FONT};">${escapeHtml(fm.excerpt)}</p>
      <a href="${url}" style="display:inline-block;padding:10px 22px;background:${C.brandPrimary};color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;font-family:${FONT};">${escapeHtml(t.readHero)} →</a>
      <!--[if gte mso 9]>
        </v:textbox>
      </v:rect>
      <![endif]-->
    </td>
  </tr>`;
}

// ── Secondary article card (WHITE bordered card) ──────────────────────────

function renderSecondaryBlock(
  a: Article,
  locale: Locale,
  siteUrl: string,
  t: (typeof T)[Locale],
): string {
  const fm = a.frontmatter;
  const url = `${siteUrl}/${locale}/${fm.category === "threat-intel" ? "threat-intel" : "articles"}/${fm.slug}`;
  const severity = fm.severity;
  const severityBadge = severity
    ? `<span style="display:inline-block;padding:3px 8px;background:${SEVERITY_COLOR[severity] ?? "#6b7280"};color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;font-family:${FONT};">${escapeHtml(severity)}</span>`
    : "";
  const categoryBadge = `<span style="display:inline-block;padding:3px 8px;background:${C.pillBg};color:${C.brandPrimary};font-size:10px;font-weight:600;text-transform:uppercase;border-radius:6px;letter-spacing:0.04em;border:1px solid ${C.pillBorder};font-family:${FONT};">${escapeHtml(fm.category)}</span>`;
  const excerpt =
    fm.excerpt.length > 140 ? fm.excerpt.slice(0, 137) + "..." : fm.excerpt;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid ${C.cardBorder};border-radius:${C.cardRadius};overflow:hidden;">
  <tr>
    <td style="padding:16px 20px;background:${C.cardBg};">
      <div style="margin-bottom:8px;">${categoryBadge}&nbsp;&nbsp;${severityBadge}</div>
      <a href="${url}" style="text-decoration:none;">
        <h3 style="margin:0 0 6px;color:${C.textPrimary};font-size:15px;line-height:1.35;font-weight:600;font-family:${FONT};">${escapeHtml(fm.title)}</h3>
      </a>
      <p style="margin:0 0 8px;color:${C.textSecondary};font-size:14px;line-height:1.5;font-family:${FONT};">${escapeHtml(excerpt)}</p>
      <a href="${url}" style="color:${C.brandPrimary};text-decoration:none;font-size:12px;font-weight:500;font-family:${FONT};">${escapeHtml(t.readMore)} →</a>
    </td>
  </tr>
</table>`;
}

export { MIN_ARTICLES_TO_SEND, MAX_ARTICLES, selectArticles };
