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
import fs from "fs";
import path from "path";
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

// ─── Last-sent state (B-020) ──────────────────────────────────────────
// Tracks the most-recent ISO timestamp of a successful digest broadcast
// per locale. The cutoff for "what's new in this digest" is
// `lastSent[locale]`, not a fixed `now - 13h` window. This prevents
// two classes of bugs inherent in the sliding-window approach:
//   - gaps: if a digest fails, articles from the missed window never
//     ship. With state-tracking, the next run picks up from the last
//     SUCCESSFUL send, not from the scheduled cron moment.
//   - duplicates: if the cron runs early / late, or an operator re-runs
//     manually, articles from the overlap would re-ship. With state-
//     tracking, each article is sent at most once per locale.
//
// The file is committed to git (see .github/workflows/email-digest.yml
// commit-back step) so GHA runners have persistent state between runs.
// Dry-runs DO NOT mutate the file — preview flows don't affect production.
const STATE_PATH = path.join(process.cwd(), "data", "digest-last-sent.json");
const FALLBACK_LOOKBACK_HOURS = 13;

interface DigestState {
  en?: string;
  zh?: string;
}

/** Best-effort load — missing file or parse failure → empty state. */
function loadDigestState(): DigestState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as DigestState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/** Best-effort write — logs but never throws, per the runner's zero-crash discipline. */
function saveDigestState(state: DigestState): void {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(state, null, 2) + "\n",
      "utf-8",
    );
  } catch (err) {
    console.warn(
      `[digest] Failed to write ${STATE_PATH}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Compute the cutoff timestamp — only articles PUBLISHED AFTER this ts
 * appear in the digest. The priority is: **never duplicate** over "never
 * skip," because duplicate digests are an immediate retention risk
 * (unsubscribe) while missed articles just stay on the site unsent.
 *
 *   cutoff = MAX(lastSent[locale], now - windowHours)
 *
 *   - If state is RECENT (last digest 6h ago) and window is 13h:
 *     cutoff = 6h ago. No dupes — only send articles newer than that.
 *   - If state is MISSING (first run ever, or file corrupted):
 *     cutoff = now - 13h. Standard sliding window.
 *   - If state is OLD (last send 25h ago — a cron missed):
 *     cutoff = now - 13h (the operator-requested window caps reach).
 *     Articles from 25h → 13h ago are orphaned. We log a warning so
 *     the operator can re-run manually with `--window-hours=25` to
 *     catch up.
 *
 * Non-numeric or future state values are treated as "missing" —
 * safer default than trusting garbage.
 */
function computeCutoffMs(
  lastSentIso: string | undefined,
  windowHours: number,
  locale: Locale,
): number {
  const now = Date.now();
  const windowFloorMs = now - windowHours * 60 * 60 * 1000;
  if (!lastSentIso) return windowFloorMs;
  const lastSentMs = new Date(lastSentIso).getTime();
  if (Number.isNaN(lastSentMs) || lastSentMs > now) return windowFloorMs;
  if (lastSentMs < windowFloorMs) {
    const hoursOld = Math.round((now - lastSentMs) / (60 * 60 * 1000));
    console.log(
      `[digest:${locale}] state is ${hoursOld}h old (> ${windowHours}h window). ` +
        `Articles older than ${windowHours}h will be orphaned. ` +
        `To catch up, re-run with --window-hours=${hoursOld + 1}.`,
    );
    return windowFloorMs;
  }
  // Happy path: state is recent → use it as the cutoff to prevent
  // duplicates from the last successful send.
  return lastSentMs;
}

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

function recentArticles(
  locale: Locale,
  windowHours: number,
  state: DigestState,
): Article[] {
  const cutoff = computeCutoffMs(state[locale], windowHours, locale);
  const cutoffIso = new Date(cutoff).toISOString();
  console.log(
    `[digest:${locale}] cutoff = ${cutoffIso} (state=${state[locale] ?? "none"}, window=${windowHours}h)`,
  );
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
): Promise<{ sent: boolean }> {
  const tag = `[digest:${locale}]`;
  if (articles.length === 0) {
    console.log(`${tag} No new articles in window — skipping.`);
    return { sent: false };
  }

  // Maya's content strategy: don't send thin digests — looks unprofessional
  const { MIN_ARTICLES_TO_SEND } = await import("@/lib/email/digest-template");
  if (articles.length < MIN_ARTICLES_TO_SEND) {
    console.log(
      `${tag} Only ${articles.length} article(s) — below minimum ${MIN_ARTICLES_TO_SEND}. Skipping.`,
    );
    return { sent: false };
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
    console.log(`${tag} DRY RUN — not sending (state NOT updated)`);
    return { sent: false };
  }

  if (!isResendConfigured() || !resend) {
    console.error(`${tag} ❌ RESEND_API_KEY not configured`);
    return { sent: false };
  }

  const audienceId = getAudienceId(locale);
  if (!audienceId) {
    console.error(
      `${tag} ❌ RESEND_AUDIENCE_ID_${locale.toUpperCase()} not set`,
    );
    return { sent: false };
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
    return { sent: false };
  }

  const sent = await resend.broadcasts.send(created.data.id);
  if (sent.error) {
    console.error(`${tag} ❌ broadcast send failed:`, sent.error);
    return { sent: false };
  }

  console.log(`${tag} ✅ sent broadcast id=${created.data.id}`);
  return { sent: true };
}

async function main() {
  const { windowHours, dryRun, locales } = parseArgs();
  console.log(
    `📬 Digest runner · window=${windowHours}h · dryRun=${dryRun} · locales=${locales.join(",")}`,
  );

  const state = loadDigestState();
  const runStart = new Date().toISOString();
  let anyLocaleSent = false;

  for (const locale of locales) {
    const articles = recentArticles(locale, windowHours, state);
    const result = await sendForLocale(locale, articles, dryRun);
    if (result.sent) {
      // Record SUCCESS only. Skipped / failed / dry-run stays unchanged
      // so the NEXT run picks up the same un-shipped articles.
      state[locale] = runStart;
      anyLocaleSent = true;
    }
  }

  if (anyLocaleSent) {
    saveDigestState(state);
    console.log(`📝 digest state updated: ${STATE_PATH}`);
  }
}

main().catch((err) => {
  console.error("💥 digest failed:", err);
  process.exit(1);
});
