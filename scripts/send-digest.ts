#!/usr/bin/env tsx
/**
 * Send the twice-daily email digest of recent articles.
 *
 * Flags:
 *   --window-hours=13  How far back to look for articles (default 13)
 *   --dry-run          Print subject + article count, do not send
 *   --locale=en|zh     Only send for one locale (default: both)
 *
 * Invoked by .github/workflows/email-digest.yml on cron schedule.
 */
import "dotenv/config";
import { getAllPosts, type Article } from "@/lib/content";
import {
  buildDigestHtml,
  buildDigestSubject,
} from "@/lib/email/digest-template";
import {
  resend,
  getAudienceId,
  isResendConfigured,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  type Locale,
} from "@/lib/resend";
import { scoreArticle } from "./pipeline/quality-scorer.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const windowHours = Number(
    args.find((a) => a.startsWith("--window-hours="))?.split("=")[1] ?? 13,
  );
  const dryRun = args.includes("--dry-run");
  const localeArg = args.find((a) => a.startsWith("--locale="))?.split("=")[1];
  const locales: Locale[] =
    localeArg === "en" || localeArg === "zh" ? [localeArg] : ["en", "zh"];
  return { windowHours, dryRun, locales };
}

/**
 * Quality retention guard (2026-04-23). With 2+ real newsletter
 * subscribers, every bad digest is a retention risk. The digest MUST
 * NOT ship articles with SERIOUS quality flags — hedging-phrase
 * content, vuln articles with no CVE ID, catastrophically-short
 * articles. Any of those in a digest can cause an unsubscribe; our
 * list is so small that one unsubscribe = 50% churn.
 *
 * Implementation: run each article through the pure quality scorer
 * and drop articles with at least one SERIOUS flag BEFORE selection.
 * WARN articles still pass — they may be imperfect but are usable.
 * If the filter leaves fewer than MIN_ARTICLES_TO_SEND, the upstream
 * caller's "thin digest — skip" guard kicks in (digest does not send).
 *
 * This is a retention guard, not a content gate. We do not REJECT
 * articles from the site — they remain indexed — we only avoid
 * pushing them to subscribers' inboxes.
 */
function isSeriousQualityArticle(
  a: Article,
  section: "posts" | "threat-intel",
  locale: Locale,
): boolean {
  const score = scoreArticle({
    slug: a.frontmatter.slug,
    locale,
    section,
    frontmatter: a.frontmatter,
    body: a.content,
  });
  return score.flags.some((f) => f.severity === "serious");
}

function recentArticles(locale: Locale, windowHours: number): Article[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const posts = getAllPosts(locale, "posts");
  const threat = getAllPosts(locale, "threat-intel");

  // Tag each article with its section so the quality scorer can apply
  // the right floor. This is local to the digest runner; we don't
  // want to mutate the shared Article type.
  type TaggedArticle = Article & { _digestSection: "posts" | "threat-intel" };
  const tagged: TaggedArticle[] = [
    ...posts.map((a) => ({ ...a, _digestSection: "posts" as const })),
    ...threat.map((a) => ({
      ...a,
      _digestSection: "threat-intel" as const,
    })),
  ];

  const withinWindow = tagged.filter(
    (a) =>
      !a.frontmatter.draft && new Date(a.frontmatter.date).getTime() >= cutoff,
  );

  const inputCount = withinWindow.length;
  const passQuality = withinWindow.filter(
    (a) => !isSeriousQualityArticle(a, a._digestSection, locale),
  );
  const droppedCount = inputCount - passQuality.length;
  if (droppedCount > 0) {
    console.log(
      `[digest:${locale}] quality guard: dropped ${droppedCount}/${inputCount} SERIOUS-flagged article(s)`,
    );
  }

  return passQuality
    .sort(
      (a, b) =>
        new Date(b.frontmatter.date).getTime() -
        new Date(a.frontmatter.date).getTime(),
    )
    .map(({ _digestSection: _omit, ...rest }) => rest as Article);
}

async function sendForLocale(
  locale: Locale,
  articles: Article[],
  dryRun: boolean,
): Promise<void> {
  const tag = `[digest:${locale}]`;
  if (articles.length === 0) {
    console.log(`${tag} No new articles in window — skipping.`);
    return;
  }

  // Maya's content strategy: don't send thin digests — looks unprofessional
  const { MIN_ARTICLES_TO_SEND } = await import("@/lib/email/digest-template");
  if (articles.length < MIN_ARTICLES_TO_SEND) {
    console.log(
      `${tag} Only ${articles.length} article(s) — below minimum ${MIN_ARTICLES_TO_SEND}. Skipping.`,
    );
    return;
  }

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com"
  ).replace(/\/$/, "");
  const unsubscribeUrl = `${siteUrl}/${locale}/unsubscribe`;
  const subject = buildDigestSubject(articles, locale);
  const html = buildDigestHtml({
    articles,
    locale,
    siteUrl,
    unsubscribeUrl,
  });

  console.log(`${tag} ${articles.length} articles, subject: "${subject}"`);

  if (dryRun) {
    console.log(`${tag} DRY RUN — not sending`);
    return;
  }

  if (!isResendConfigured() || !resend) {
    console.error(`${tag} ❌ RESEND_API_KEY not configured`);
    return;
  }

  const audienceId = getAudienceId(locale);
  if (!audienceId) {
    console.error(
      `${tag} ❌ RESEND_AUDIENCE_ID_${locale.toUpperCase()} not set`,
    );
    return;
  }

  const created = await resend.broadcasts.create({
    audienceId,
    from: EMAIL_FROM,
    subject,
    html,
    replyTo: EMAIL_REPLY_TO,
  });

  if (created.error || !created.data) {
    console.error(`${tag} ❌ broadcast create failed:`, created.error);
    return;
  }

  const sent = await resend.broadcasts.send(created.data.id);
  if (sent.error) {
    console.error(`${tag} ❌ broadcast send failed:`, sent.error);
    return;
  }

  console.log(`${tag} ✅ sent broadcast id=${created.data.id}`);
}

async function main() {
  const { windowHours, dryRun, locales } = parseArgs();
  console.log(
    `📬 Digest runner · window=${windowHours}h · dryRun=${dryRun} · locales=${locales.join(",")}`,
  );

  for (const locale of locales) {
    const articles = recentArticles(locale, windowHours);
    await sendForLocale(locale, articles, dryRun);
  }
}

main().catch((err) => {
  console.error("💥 digest failed:", err);
  process.exit(1);
});
