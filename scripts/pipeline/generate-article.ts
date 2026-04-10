import { generateText } from "ai";
import { articleModel } from "../ai/provider.js";
import { buildArticlePrompt } from "../ai/prompts/article.js";
import {
  GeneratedArticleSchema,
  type GeneratedArticle,
} from "../ai/schemas/article-schema.js";
import { withRetry } from "../utils/rate-limit.js";
import type { Story } from "../utils/dedup.js";

/** Generate a single article from 1-5 source stories using DeepSeek-V3. */
export async function generateArticle(
  stories: Story[],
): Promise<GeneratedArticle | null> {
  const prompt = buildArticlePrompt(stories);

  const { text } = await withRetry(() =>
    generateText({
      model: articleModel,
      prompt,
      maxOutputTokens: 3000,
      temperature: 0.55,
    }),
  );

  // Strip potential markdown code fences around JSON
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(
      "[generate] JSON parse failed. Raw output:\n",
      text.slice(0, 500),
    );
    return null;
  }

  const result = GeneratedArticleSchema.safeParse(parsed);
  if (!result.success) {
    console.error(
      "[generate] Schema validation failed:",
      result.error.flatten(),
    );
    return null;
  }

  return result.data;
}
