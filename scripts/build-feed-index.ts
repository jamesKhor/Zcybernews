#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { getAllPosts } from "../lib/content.js";
import { buildFeedIndexArticle, type FeedIndex } from "../lib/feed-index.js";
import { isPublicArticle } from "../lib/publication.js";
import type { ArticleLocale, ArticleSection } from "../lib/article-url.js";

const OUTPUT_PATH = path.join(process.cwd(), "data", "feed-index.json");
const LOCALES: ArticleLocale[] = ["en", "zh"];
const SECTIONS: ArticleSection[] = ["posts", "threat-intel"];

function buildFeedIndex(): FeedIndex {
  const articles: FeedIndex["articles"] = [];

  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      articles.push(
        ...getAllPosts(locale, section)
          .filter(isPublicArticle)
          .map((article) => buildFeedIndexArticle(article, locale, section)),
      );
    }
  }

  const latestArticleMs = articles.reduce((latest, article) => {
    const ms = new Date(article.date).getTime();
    return Number.isFinite(ms) ? Math.max(latest, ms) : latest;
  }, 0);

  return {
    generatedAt: latestArticleMs
      ? new Date(latestArticleMs).toISOString()
      : "1970-01-01T00:00:00.000Z",
    articles,
  };
}

async function main() {
  const index = buildFeedIndex();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    `${OUTPUT_PATH}.tmp`,
    await prettier.format(JSON.stringify(index), { parser: "json" }),
  );
  fs.renameSync(`${OUTPUT_PATH}.tmp`, OUTPUT_PATH);

  const counts = LOCALES.map(
    (locale) =>
      `${locale}:${index.articles.filter((article) => article.locale === locale).length}`,
  ).join(" ");
  console.log(
    `[feed-index] indexed ${index.articles.length} articles (${counts})`,
  );
}

main().catch((err) => {
  console.error("[feed-index] failed:", err);
  process.exit(1);
});
