import { generateText } from "ai";
import { translationModel } from "../ai/provider.js";
import {
  buildTranslationPrompt,
  buildZhMetaPrompt,
} from "../ai/prompts/translation.js";
import { withRetry } from "../utils/rate-limit.js";
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";

export type TranslatedMeta = {
  title: string;
  excerpt: string;
  body: string;
};

/** Translate an English article to Chinese using Kimi K2. */
export async function translateArticle(
  article: GeneratedArticle,
): Promise<TranslatedMeta | null> {
  try {
    // Translate body
    const { text: zhBody } = await withRetry(() =>
      generateText({
        model: translationModel,
        prompt: buildTranslationPrompt(article.body, article.title),
        maxOutputTokens: 4000,
        temperature: 0.3,
      }),
    );

    // Translate title + excerpt
    const { text: metaRaw } = await withRetry(() =>
      generateText({
        model: translationModel,
        prompt: buildZhMetaPrompt(article.excerpt, article.title),
        maxOutputTokens: 300,
        temperature: 0.2,
      }),
    );

    let zhTitle = article.title;
    let zhExcerpt = article.excerpt;

    try {
      const cleaned = metaRaw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      const meta = JSON.parse(cleaned) as { title?: string; excerpt?: string };
      if (meta.title) zhTitle = meta.title;
      if (meta.excerpt) zhExcerpt = meta.excerpt;
    } catch {
      console.warn(
        "[translate] Meta JSON parse failed, using English title/excerpt",
      );
    }

    return { title: zhTitle, excerpt: zhExcerpt, body: zhBody };
  } catch (err) {
    console.error("[translate] Translation failed:", err);
    return null;
  }
}
