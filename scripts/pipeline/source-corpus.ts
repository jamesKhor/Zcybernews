import type { Story } from "../utils/dedup.js";

const MAX_PROMPT_SOURCE_CHARS = 6_000;

function truncateSourceText(text: string, maxChars = MAX_PROMPT_SOURCE_CHARS) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).replace(/\s+\S*$/, "") + "...";
}

export function storySourceText(story: Story): string {
  return [story.title, story.excerpt, story.rawText]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

export function buildSourceCorpus(stories: Story[]): string {
  return stories.map(storySourceText).join("\n");
}

export function formatStoryForPrompt(story: Story): string {
  const lines = [`URL: ${story.url}`, `RSS excerpt: ${story.excerpt}`];

  if (story.rawText) {
    lines.push(`Fetched article text: ${truncateSourceText(story.rawText)}`);
  }

  return lines.join("\n");
}
