/**
 * Tag intro reader — mirrors the mtime-keyed memo pattern in lib/content.ts.
 *
 * Cache auto-invalidates when the data/tag-intros/{locale} directory mtime
 * changes (new intro landed). Shared across all routes + requests in a
 * single Node process. No explicit invalidation needed.
 */
import fs from "fs";
import path from "path";

export interface TagIntro {
  tag: string;
  locale: "en" | "zh";
  intro: string;
  model: string;
  generated_at: string;
}

const INTROS_DIR = path.join(process.cwd(), "data", "tag-intros");

interface CacheEntry {
  mtimeMs: number;
  map: Map<string, TagIntro>;
}

const cache = new Map<string, CacheEntry>();

function sanitize(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadLocale(locale: "en" | "zh"): Map<string, TagIntro> {
  const dir = path.join(INTROS_DIR, locale);
  if (!fs.existsSync(dir)) return new Map();

  const mtimeMs = fs.statSync(dir).mtimeMs;
  const cached = cache.get(locale);
  if (cached && cached.mtimeMs === mtimeMs) return cached.map;

  const map = new Map<string, TagIntro>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const record = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf-8"),
      ) as TagIntro;
      map.set(sanitize(record.tag), record);
    } catch {
      // Malformed file — skip silently. Audit pipeline catches these.
    }
  }
  cache.set(locale, { mtimeMs, map });
  return map;
}

export function getTagIntro(locale: string, tag: string): TagIntro | null {
  if (locale !== "en" && locale !== "zh") return null;
  const map = loadLocale(locale);
  return map.get(sanitize(tag)) ?? null;
}
