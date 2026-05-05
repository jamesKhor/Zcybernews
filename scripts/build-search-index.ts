#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  ArticleFrontmatterSchema,
  type ArticleFrontmatter,
} from "../lib/types.js";
import { buildSearchIndexRecord } from "./search-index-records.js";
import type { ArticleLocale, ArticleSection } from "../lib/article-url.js";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const OUTPUT_DIR = path.join(process.cwd(), "public", "pagefind");
const LOCALES: ArticleLocale[] = ["en", "zh"];
const SECTIONS: ArticleSection[] = ["posts", "threat-intel"];
let pagefindModule: typeof import("pagefind") | null = null;

interface LoadedArticle {
  filePath: string;
  locale: ArticleLocale;
  section: ArticleSection;
  frontmatter: ArticleFrontmatter;
  content: string;
}

function isPublishedNow(frontmatter: ArticleFrontmatter): boolean {
  if (frontmatter.draft) return false;
  if (frontmatter.scheduled_publish) {
    return new Date(frontmatter.scheduled_publish) <= new Date();
  }
  return true;
}

function loadArticles(): LoadedArticle[] {
  const articles: LoadedArticle[] = [];

  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      const dir = path.join(CONTENT_ROOT, locale, section);
      if (!fs.existsSync(dir)) continue;

      const files = fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".mdx") || file.endsWith(".md"));

      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const parsed = matter(fs.readFileSync(filePath, "utf-8"));
          const result = ArticleFrontmatterSchema.safeParse(parsed.data);
          if (!result.success) {
            console.warn(
              `[search-index] skipping invalid frontmatter in ${filePath}`,
            );
            continue;
          }

          if (!isPublishedNow(result.data)) {
            continue;
          }

          articles.push({
            filePath,
            locale,
            section,
            frontmatter: result.data,
            content: parsed.content,
          });
        } catch (err) {
          console.warn(
            `[search-index] skipping ${filePath}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }

  return articles;
}

async function main() {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });

  pagefindModule = await import("pagefind");
  const pagefind = pagefindModule;
  const { index, errors } = await pagefind.createIndex();
  if (!index) {
    throw new Error(
      `[search-index] Pagefind failed to create an index: ${errors.join(", ")}`,
    );
  }

  const articles = loadArticles();
  let indexed = 0;

  for (const article of articles) {
    const record = buildSearchIndexRecord(article);
    const result = await index.addCustomRecord(record);
    if (result.errors.length > 0) {
      console.warn(
        `[search-index] Pagefind rejected ${article.filePath}: ${result.errors.join(", ")}`,
      );
      continue;
    }
    indexed += 1;
  }

  const writeResult = await index.writeFiles({ outputPath: OUTPUT_DIR });
  if (writeResult.errors.length > 0) {
    throw new Error(
      `[search-index] Pagefind failed to write files: ${writeResult.errors.join(", ")}`,
    );
  }

  await pagefind.close();
  console.log(`[search-index] indexed ${indexed} articles into ${OUTPUT_DIR}`);
}

main().catch(async (err) => {
  await pagefindModule?.close().catch(() => null);
  console.error(err);
  process.exit(1);
});
