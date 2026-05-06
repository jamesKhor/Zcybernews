#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ArticleFrontmatterSchema } from "../lib/types.js";
import { isSearchIndexableFrontmatter } from "./build-search-index.js";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const LOCALES = ["en", "zh"] as const;
const SECTIONS = ["posts", "threat-intel"] as const;

let total = 0;
let indexable = 0;
let blocked = 0;
const failures: string[] = [];

for (const locale of LOCALES) {
  for (const section of SECTIONS) {
    const dir = path.join(CONTENT_ROOT, locale, section);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".mdx") && !file.endsWith(".md")) continue;
      total += 1;

      const filePath = path.join(dir, file);
      const parsed = matter(fs.readFileSync(filePath, "utf-8"));
      const result = ArticleFrontmatterSchema.safeParse(parsed.data);
      if (!result.success) {
        failures.push(`${filePath}: invalid frontmatter`);
        continue;
      }

      if (isSearchIndexableFrontmatter(result.data)) {
        indexable += 1;
        continue;
      }

      blocked += 1;
    }
  }
}

console.log(
  `[pagefind-public-audit] total=${total} indexable=${indexable} blocked=${blocked}`,
);

if (failures.length > 0) {
  for (const failure of failures.slice(0, 20)) {
    console.error(`[pagefind-public-audit] ${failure}`);
  }
  if (failures.length > 20) {
    console.error(
      `[pagefind-public-audit] ...and ${failures.length - 20} more`,
    );
  }
  process.exit(1);
}
