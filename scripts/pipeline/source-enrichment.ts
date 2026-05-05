import { fetchArticle } from "../../lib/article-fetcher.js";
import type { Story } from "../utils/dedup.js";
import { limit } from "../utils/rate-limit.js";

const FETCH_TIMEOUT_MS = 8_000;
const MIN_USEFUL_TEXT_CHARS = 300;

function shouldFetchSource(story: Story): boolean {
  const type = story.sourceType ?? "rss";
  return type === "rss" && /^https?:\/\//i.test(story.url);
}

export async function enrichStorySource(story: Story): Promise<Story> {
  if (!shouldFetchSource(story)) return story;

  let fetched: Awaited<ReturnType<typeof fetchArticle>>;
  try {
    fetched = await fetchArticle(story.url, FETCH_TIMEOUT_MS);
  } catch (err) {
    console.log(
      `[source-fetch] fallback ${story.sourceId ?? story.sourceName}: ` +
        `"${story.title.slice(0, 80)}" ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
    return story;
  }

  if (fetched.error || fetched.text.length < MIN_USEFUL_TEXT_CHARS) {
    console.log(
      `[source-fetch] fallback ${story.sourceId ?? story.sourceName}: ` +
        `"${story.title.slice(0, 80)}" ` +
        `(${fetched.error ?? `${fetched.text.length} chars`})`,
    );
    return story;
  }

  console.log(
    `[source-fetch] enriched ${story.sourceId ?? story.sourceName}: ` +
      `"${story.title.slice(0, 80)}" (${fetched.text.length} chars)`,
  );
  return { ...story, rawText: fetched.text };
}

export async function enrichStoriesForGeneration<T extends Story>(
  stories: T[],
): Promise<T[]> {
  return Promise.all(
    stories.map((story) =>
      limit(async () => {
        const enriched = await enrichStorySource(story);
        return { ...story, ...enriched } as T;
      }),
    ),
  );
}
