#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import sitemap from "../app/sitemap.js";
import robots from "../app/robots.js";
import { getAllPosts } from "../lib/content.js";
import { articleUrl, type ArticleLocale } from "../lib/article-url.js";
import {
  buildCurrentNewsSitemapXml,
  NEWS_SITEMAP_PATH,
} from "../lib/news-sitemap.js";
import { isPublicArticle } from "../lib/publication.js";
import { getSiteUrl } from "../lib/site-url.js";
import {
  getPublicTopicHubDefinitions,
  topicHubUrl,
} from "../lib/topic-hubs.js";

const LOCALES: ArticleLocale[] = ["en", "zh"];
const SECTIONS = ["posts", "threat-intel"] as const;
const BASE_URL = getSiteUrl();
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

const entries = sitemap();
const urls = entries.map((entry) => entry.url);
const uniqueUrls = new Set(urls);

if (uniqueUrls.size !== urls.length) {
  const duplicates = urls.filter((url, idx) => urls.indexOf(url) !== idx);
  fail(`duplicate sitemap URLs: ${[...new Set(duplicates)].slice(0, 10)}`);
}

for (const url of urls) {
  if (!url.startsWith(`${BASE_URL}/`))
    fail(`non-canonical host in sitemap: ${url}`);
  if (url.includes("www.zcybernews.com")) fail(`www URL in sitemap: ${url}`);
  if (/\/api\/|\/admin\//.test(url)) fail(`private URL in sitemap: ${url}`);
}

const sitemapSet = new Set(urls);
const publicArticleUrls = new Set<string>();
const nonPublicArticleUrls = new Set<string>();

for (const locale of LOCALES) {
  for (const section of SECTIONS) {
    for (const article of getAllPosts(locale, section)) {
      const url = `${BASE_URL}${articleUrl(
        { slug: article.frontmatter.slug },
        locale,
        section,
      )}`;
      if (isPublicArticle(article)) publicArticleUrls.add(url);
      else nonPublicArticleUrls.add(url);
    }
  }
}

for (const url of publicArticleUrls) {
  if (!sitemapSet.has(url)) fail(`public article missing from sitemap: ${url}`);
}

for (const url of nonPublicArticleUrls) {
  if (sitemapSet.has(url))
    fail(`non-public article included in sitemap: ${url}`);
}

for (const locale of LOCALES) {
  for (const hub of getPublicTopicHubDefinitions(locale)) {
    const url = `${BASE_URL}${topicHubUrl(hub.slug, locale)}`;
    if (!sitemapSet.has(url))
      fail(`public topic hub missing from sitemap: ${url}`);
  }
}

const generatedRobots = robots();
const robotSitemaps = Array.isArray(generatedRobots.sitemap)
  ? generatedRobots.sitemap
  : [generatedRobots.sitemap];
if (!robotSitemaps.includes(`${BASE_URL}/sitemap.xml`)) {
  fail(`robots sitemap does not point at ${BASE_URL}/sitemap.xml`);
}
if (!robotSitemaps.includes(`${BASE_URL}${NEWS_SITEMAP_PATH}`)) {
  fail(`robots sitemap does not point at ${BASE_URL}${NEWS_SITEMAP_PATH}`);
}

const newsSitemapXml = buildCurrentNewsSitemapXml();
if (
  !newsSitemapXml.includes(
    'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"',
  )
) {
  fail("news sitemap missing Google News namespace");
}

const feedIndexPath = path.join(process.cwd(), "data", "feed-index.json");
if (!fs.existsSync(feedIndexPath)) {
  fail("data/feed-index.json is missing");
} else {
  const feedIndex = JSON.parse(fs.readFileSync(feedIndexPath, "utf-8")) as {
    generatedAt?: string;
    articles?: unknown[];
  };
  if (!feedIndex.generatedAt) fail("feed index missing generatedAt");
  if (!Array.isArray(feedIndex.articles))
    fail("feed index articles is invalid");
}

console.log(
  `[seo-surfaces-audit] sitemap=${urls.length} publicArticles=${publicArticleUrls.size} nonPublicArticles=${nonPublicArticleUrls.size}`,
);

if (failures.length > 0) {
  for (const failure of failures.slice(0, 50)) {
    console.error(`[seo-surfaces-audit] ${failure}`);
  }
  if (failures.length > 50) {
    console.error(`[seo-surfaces-audit] ...and ${failures.length - 50} more`);
  }
  process.exit(1);
}
