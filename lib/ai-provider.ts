/**
 * AI Provider Factory
 *
 * Priority order (first configured key wins):
 *   1. OPENROUTER_API_KEY  → OpenRouter (free models, OpenAI-compatible)
 *   2. DEEPSEEK_API_KEY    → DeepSeek (paid, fast, cheap)
 *
 * To switch: just set/unset the env vars in Vercel or .env.local.
 * No code changes needed.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";

// ─── OpenRouter free model IDs ────────────────────────────────────────────────
// Best for article writing (EN cybersecurity content)
export const OPENROUTER_WRITE_MODEL =
  process.env.OPENROUTER_WRITE_MODEL ?? "meta-llama/llama-4-maverick:free";

// Best for EN → Simplified Chinese translation (Qwen native Chinese training)
export const OPENROUTER_TRANSLATE_MODEL =
  process.env.OPENROUTER_TRANSLATE_MODEL ?? "qwen/qwen3-next-80b-a3b-instruct:free";

// ─── DeepSeek model IDs ───────────────────────────────────────────────────────
export const DEEPSEEK_WRITE_MODEL = "deepseek-chat";
export const DEEPSEEK_TRANSLATE_MODEL = "deepseek-chat";

// ─── Provider detection ───────────────────────────────────────────────────────
export type AIProvider = "openrouter" | "deepseek" | "none";

export function getActiveProvider(): AIProvider {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "none";
}

// ─── Model factories ──────────────────────────────────────────────────────────

/**
 * Returns the model to use for article writing/synthesis.
 * Throws if no API key is configured.
 */
export function getWriteModel(): LanguageModelV1 {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://alecybernews.vercel.app",
        "X-Title": "AleCyberNews",
      },
    });
    return openrouter(OPENROUTER_WRITE_MODEL);
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
    return deepseek(DEEPSEEK_WRITE_MODEL);
  }

  throw new Error(
    "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY.",
  );
}

/**
 * Returns the model to use for EN → ZH translation.
 * Uses Qwen on OpenRouter (superior Chinese quality) or DeepSeek as fallback.
 */
export function getTranslateModel(): LanguageModelV1 {
  if (process.env.OPENROUTER_API_KEY) {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://alecybernews.vercel.app",
        "X-Title": "AleCyberNews",
      },
    });
    return openrouter(OPENROUTER_TRANSLATE_MODEL);
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const deepseek = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
    return deepseek(DEEPSEEK_TRANSLATE_MODEL);
  }

  throw new Error(
    "No AI provider configured. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY.",
  );
}

/**
 * Returns a human-readable label for the active provider (for logs/toasts).
 */
export function getProviderLabel(): string {
  if (process.env.OPENROUTER_API_KEY) {
    return `OpenRouter (${OPENROUTER_WRITE_MODEL})`;
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return "DeepSeek (deepseek-chat)";
  }
  return "none";
}
