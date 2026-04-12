/**
 * Deduplicates a list of stories by URL hash and fuzzy title similarity.
 * Keeps only the first occurrence of each near-duplicate.
 */
import fs from "fs";
import path from "path";

export type Story = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  sourceName: string;
  publishedAt: string;
  tags: string[];
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a).split(" ");
  const nb = normalizeTitle(b).split(" ");
  const setA = new Set(na);
  const setB = new Set(nb);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function deduplicate(
  stories: Story[],
  similarityThreshold = 0.65,
): Story[] {
  const seen: Story[] = [];

  for (const story of stories) {
    const isDuplicate = seen.some(
      (s) =>
        s.url === story.url ||
        titleSimilarity(s.title, story.title) >= similarityThreshold,
    );
    if (!isDuplicate) seen.push(story);
  }

  return seen;
}

/**
 * Load recently published article titles from content/en/ directory.
 * Only returns articles published within the last `withinDays` days.
 * Used to prevent generating articles on topics recently covered.
 * Articles older than the window are allowed to be revisited.
 */
export function loadRecentPublishedTitles(withinDays = 14): string[] {
  const contentRoot = path.join(process.cwd(), "content", "en");
  const dirs = ["posts", "threat-intel"];
  const titles: string[] = [];
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;

  for (const dir of dirs) {
    const dirPath = path.join(contentRoot, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".mdx"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
        // Extract title from frontmatter
        const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
        if (!titleMatch?.[1]) continue;
        // Extract date from frontmatter
        const dateMatch = content.match(
          /^date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m,
        );
        if (!dateMatch?.[1]) continue;
        const articleDate = new Date(dateMatch[1]).getTime();
        // Only include articles within the recency window
        if (articleDate >= cutoff) {
          titles.push(titleMatch[1].trim());
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return titles;
}
