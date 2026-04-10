/**
 * Deduplicates a list of stories by URL hash and fuzzy title similarity.
 * Keeps only the first occurrence of each near-duplicate.
 */
export type Story = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  sourceName: string;
  publishedAt: string;
  tags: string[];
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
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
