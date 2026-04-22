/**
 * Discord notifier — posts new articles to a Discord channel via webhook.
 *
 * Principle: deterministic side-effect. No LLM tokens. One HTTP POST per
 * published article. Webhooks don't require a bot, OAuth, or a running
 * server on the Discord side — you just create a webhook in Discord's
 * channel settings and copy the URL.
 *
 * Two locales → two webhooks:
 *   DISCORD_WEBHOOK_EN  → posts to #en-news-feed
 *   DISCORD_WEBHOOK_ZH  → posts to #zh-news-feed
 *
 * If the relevant webhook is missing, logs a notice and skips silently —
 * never fails the pipeline. Discord is optional amplification, not a
 * hard dependency.
 */
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import {
  absoluteArticleUrl,
  type ArticleLocale,
  type ArticleSection,
} from "../../lib/article-url.js";

type DiscordColor =
  | 0xdc2626 // red — critical
  | 0xf97316 // orange — high
  | 0xeab308 // yellow — medium
  | 0x22c55e // green — low / informational
  | 0x64748b; // slate — default

function severityColor(severity: string | null | undefined): DiscordColor {
  switch (severity) {
    case "critical":
      return 0xdc2626;
    case "high":
      return 0xf97316;
    case "medium":
      return 0xeab308;
    case "low":
    case "informational":
      return 0x22c55e;
    default:
      return 0x64748b;
  }
}

// Kept for the avatar_url static-asset reference below; `absoluteArticleUrl`
// owns all article-URL construction per Phase B.3.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";

/**
 * Post a single article to the locale's Discord channel. Returns true if
 * posted, false if skipped (missing webhook). Throws only on unexpected
 * runtime errors — NOT on non-2xx responses (we log and continue).
 */
export async function notifyDiscord(
  article: GeneratedArticle,
  locale: ArticleLocale,
  section: ArticleSection,
): Promise<boolean> {
  const webhookEnv =
    locale === "zh" ? "DISCORD_WEBHOOK_ZH" : "DISCORD_WEBHOOK_EN";
  const webhook = process.env[webhookEnv];

  if (!webhook) {
    console.log(
      `[discord] ${webhookEnv} not set — skipping notification for "${article.title}"`,
    );
    return false;
  }

  const url = absoluteArticleUrl({ slug: article.slug }, locale, section);

  // Discord embed — rich card with title, description, color by severity.
  // Keep it simple: title + excerpt + link. Tag list as footer.
  const embed = {
    title: article.title.slice(0, 256), // Discord limit
    description: article.excerpt?.slice(0, 500) ?? "",
    url,
    color: severityColor(article.severity),
    fields: [
      ...(article.cve_ids && article.cve_ids.length > 0
        ? [
            {
              name: "CVEs",
              value: article.cve_ids.slice(0, 5).join(", "),
              inline: true,
            },
          ]
        : []),
      ...(article.severity
        ? [
            {
              name: "Severity",
              value: article.severity,
              inline: true,
            },
          ]
        : []),
      ...(article.category
        ? [
            {
              name: "Category",
              value: article.category,
              inline: true,
            },
          ]
        : []),
    ],
    footer: {
      text:
        article.tags && article.tags.length > 0
          ? article.tags
              .slice(0, 5)
              .map((t) => `#${t}`)
              .join(" · ")
          : "ZCyberNews",
    },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    username: locale === "zh" ? "ZCyberNews 中文" : "ZCyberNews",
    avatar_url: `${SITE_URL}/android-chrome-192x192.png`,
    embeds: [embed],
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[discord] ${res.status} ${res.statusText} posting "${article.title}" — ${body.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[discord] Network error posting "${article.title}":`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
