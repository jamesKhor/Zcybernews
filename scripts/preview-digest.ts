#!/usr/bin/env tsx
/**
 * Digest preview — render the NEXT digest and send ONLY to a single
 * email address (NOT the real subscriber audience). Safe for QA /
 * visual review before trusting the next scheduled broadcast.
 *
 * Does NOT touch `resend.broadcasts.*`. Uses `resend.emails.send()`
 * with a literal `to: [email]` so no subscriber is affected.
 *
 * Usage:
 *   tsx scripts/preview-digest.ts --to=you@example.com
 *   tsx scripts/preview-digest.ts --to=you@example.com --window-hours=72
 *   tsx scripts/preview-digest.ts --to=you@example.com --locale=zh
 *   tsx scripts/preview-digest.ts --to=you@example.com --html-only  # no send, write file
 *
 * --html-only writes the rendered HTML to data/digest-preview-<locale>.html
 * instead of sending. Useful if RESEND_API_KEY isn't set locally.
 *
 * Pre-flight: requires RESEND_API_KEY in .env.local (same as the real
 * digest runner). To set temporarily:
 *   echo "RESEND_API_KEY=re_xxx..." >> .env.local
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { getAllPosts, type Article } from "@/lib/content";
import {
  buildDigestHtml,
  buildDigestSubject,
} from "@/lib/email/digest-template";
import { scoreArticle } from "./pipeline/quality-scorer.js";
import {
  resend,
  isResendConfigured,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  type Locale,
} from "@/lib/resend";

function parseArgs() {
  const args = process.argv.slice(2);
  const to = args.find((a) => a.startsWith("--to="))?.split("=")[1];
  const windowHours = Number(
    args.find((a) => a.startsWith("--window-hours="))?.split("=")[1] ?? 72,
  );
  const localeArg = args.find((a) => a.startsWith("--locale="))?.split("=")[1];
  const locale: Locale =
    localeArg === "zh" || localeArg === "en" ? localeArg : "en";
  const htmlOnly = args.includes("--html-only");
  return { to, windowHours, locale, htmlOnly };
}

function pickArticles(locale: Locale, windowHours: number): Article[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const posts = getAllPosts(locale, "posts");
  const threat = getAllPosts(locale, "threat-intel");
  type Tagged = Article & { _s: "posts" | "threat-intel" };
  const tagged: Tagged[] = [
    ...posts.map((a) => ({ ...a, _s: "posts" as const })),
    ...threat.map((a) => ({ ...a, _s: "threat-intel" as const })),
  ];
  const within = tagged.filter(
    (a) =>
      !a.frontmatter.draft && new Date(a.frontmatter.date).getTime() >= cutoff,
  );
  const passed = within.filter((a) => {
    const s = scoreArticle({
      slug: a.frontmatter.slug,
      locale,
      section: a._s,
      frontmatter: a.frontmatter,
      body: a.content,
    });
    return !s.flags.some((f) => f.severity === "serious");
  });
  return passed
    .sort(
      (a, b) =>
        new Date(b.frontmatter.date).getTime() -
        new Date(a.frontmatter.date).getTime(),
    )
    .map(({ _s: _omit, ...rest }) => rest as Article);
}

async function main() {
  const { to, windowHours, locale, htmlOnly } = parseArgs();

  if (!to && !htmlOnly) {
    console.error(
      "ERROR: --to=<email> is required (or pass --html-only to write file instead)",
    );
    process.exit(1);
  }

  const articles = pickArticles(locale, windowHours);
  if (articles.length < 3) {
    console.error(
      `Only ${articles.length} articles in ${windowHours}h window (after quality filter) — below minimum 3. Try --window-hours=168 for a full week.`,
    );
    process.exit(1);
  }

  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com"
  ).replace(/\/$/, "");

  // Use a PREVIEW unsubscribe URL so it's obvious this is not live.
  const unsubscribeUrl = `${siteUrl}/${locale}/unsubscribe?preview=1`;

  const subject = "[PREVIEW] " + buildDigestSubject(articles, locale);
  const html = buildDigestHtml({
    articles,
    locale,
    siteUrl,
    unsubscribeUrl,
  });

  console.log(`Preview:   subject="${subject}"`);
  console.log(`           ${articles.length} articles, locale=${locale}`);

  if (htmlOnly) {
    const outPath = path.join(
      process.cwd(),
      "data",
      `digest-preview-${locale}.html`,
    );
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`Wrote:     ${outPath} (${html.length} bytes)`);
    console.log(`Open:      file:///${outPath.replace(/\\/g, "/")}`);
    return;
  }

  if (!isResendConfigured() || !resend) {
    console.error(
      "ERROR: RESEND_API_KEY not configured. Either set it in .env.local, OR re-run with --html-only to write the HTML to a file.",
    );
    process.exit(1);
  }

  console.log(`Sending:   to=${to}`);
  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to: to as string, // validated above
    subject,
    html,
    replyTo: EMAIL_REPLY_TO,
    // Explicitly NOT using audienceId or broadcasts.* —
    // this is a single-recipient one-off, zero risk to real subs.
    headers: {
      "X-ZCybernews-Kind": "digest-preview",
    },
    tags: [{ name: "kind", value: "preview" }],
  });

  if (result.error) {
    console.error("ERROR sending preview:", result.error);
    process.exit(1);
  }

  console.log(`✅ Sent preview. Resend id=${result.data?.id}`);
  console.log(
    "   Check your inbox + spam folder. The unsubscribe link in this preview is a dummy.",
  );
}

main().catch((err) => {
  console.error("💥 preview failed:", err);
  process.exit(1);
});
