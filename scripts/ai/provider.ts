/**
 * Pipeline AI Provider — OpenRouter free-first, DeepSeek/Kimi paid fallback
 *
 * Generation: OpenRouter free (≥12B) → DeepSeek (paid)
 * Translation: OpenRouter free (Qwen-first) → Kimi (paid) → DeepSeek (paid)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type { LanguageModel, LanguageModelUsage } from "ai";

// ─── Paid model configs ─────────────────────────────────────────────────────
const DEEPSEEK_MODEL = "deepseek-chat";
const KIMI_MODEL = "moonshot-v1-32k";

const MIN_EFFECTIVE_PARAMS_B = 12;
const MIN_CONTEXT_LENGTH = 32_000;
const FREE_MODEL_TIMEOUT_MS = 90_000; // 90s per free model attempt

// Set to true to attempt OpenRouter free models before paid fallback.
// Currently DISABLED because:
//   - Free models hit per-day rate limits fast (OpenRouter gives ~10
//     req/day per model on the free tier), so every request falls through
//     all 14 models and wastes 5-10 minutes before reaching the paid API.
//   - Free models are unreliable (Provider errors, timeouts).
//   - DeepSeek is cheap enough (~$0.27 / 1M tokens) to use directly.
// Set this to true AND ensure OPENROUTER_API_KEY is set to re-enable.
// Controlled at runtime by env var PIPELINE_USE_FREE_MODELS=true
const USE_FREE_MODELS =
  process.env.PIPELINE_USE_FREE_MODELS === "true" &&
  !!process.env.OPENROUTER_API_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtTokens(usage?: LanguageModelUsage): string {
  if (!usage) return "tokens: ?";
  return `${usage.inputTokens ?? "?"}in→${usage.outputTokens ?? "?"}out`;
}

function fmtElapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(1) + "s";
}

// ─── Client factories ───────────────────────────────────────────────────────
function makeOpenRouterClient() {
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY!,
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com",
      "X-Title": "ZCyberNews",
    },
  });
}

function makeDeepSeekClient() {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY!,
  });
}

function makeKimiClient() {
  return createOpenAICompatible({
    name: "kimi",
    baseURL: "https://api.moonshot.cn/v1",
    apiKey: process.env.KIMI_API_KEY!,
  });
}

// ─── Parse model size from ID ───────────────────────────────────────────────
function parseEffectiveParams(modelId: string): number | null {
  const id =
    modelId
      .replace(/:free$/, "")
      .split("/")
      .pop() ?? modelId;
  const activeMatch = id.match(/-a(\d+(?:\.\d+)?)b(?:-|$)/i);
  if (activeMatch) return parseFloat(activeMatch[1]);
  const allMatches = [...id.matchAll(/(\d+(?:\.\d+)?)b(?:-|_|\.|$)/gi)];
  if (allMatches.length > 0)
    return parseFloat(allMatches[allMatches.length - 1][1]);
  return null;
}

function isUsableModel(model: { id: string; context_length: number }): boolean {
  if (model.context_length < MIN_CONTEXT_LENGTH) return false;
  const effective = parseEffectiveParams(model.id);
  if (effective === null) return true;
  return effective >= MIN_EFFECTIVE_PARAMS_B;
}

// ─── Free model list (5-min cache) ──────────────────────────────────────────
type CachedModels = { write: string[]; translate: string[]; fetchedAt: number };
let _cache: CachedModels | null = null;

const HARDCODED_WRITE = [
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-coder:free",
  "minimax/minimax-m2.5:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-3-27b-it:free",
  "openai/gpt-oss-20b:free",
  "z-ai/glm-4.5-air:free",
];

const HARDCODED_TRANSLATE = [
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-3-27b-it:free",
  "openai/gpt-oss-20b:free",
];

async function getFreeModels(): Promise<{
  write: string[];
  translate: string[];
}> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < 5 * 60 * 1000) return _cache;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`${res.status}`);

    const data = (await res.json()) as {
      data: { id: string; context_length: number }[];
    };
    const free = data.data.filter(
      (m) => m.id.endsWith(":free") && m.id !== "openrouter/free",
    );
    const usable = free.filter(isUsableModel);

    usable.sort((a, b) => {
      const ea = parseEffectiveParams(a.id) ?? 999;
      const eb = parseEffectiveParams(b.id) ?? 999;
      return eb - ea;
    });

    const write = usable.map((m) => m.id);
    const translate = [
      ...usable.filter((m) => m.id.includes("qwen")).map((m) => m.id),
      ...usable.filter((m) => !m.id.includes("qwen")).map((m) => m.id),
    ];

    console.log(
      `[ai-provider] Loaded ${write.length} usable free models from OpenRouter`,
    );
    _cache = { write, translate, fetchedAt: now };
    return _cache;
  } catch (err) {
    console.warn(
      `[ai-provider] OpenRouter model list fetch failed (${err}), using hardcoded fallback`,
    );
    _cache = {
      write: HARDCODED_WRITE,
      translate: HARDCODED_TRANSLATE,
      fetchedAt: now,
    };
    return _cache;
  }
}

// ─── Try free models in order ───────────────────────────────────────────────
async function tryFreeModels(
  modelIds: string[],
  prompt: string,
  opts: { maxOutputTokens: number; temperature: number; minLength: number },
): Promise<{
  text: string;
  modelUsed: string;
  usage?: LanguageModelUsage;
  elapsedMs: number;
} | null> {
  const or = makeOpenRouterClient();

  for (const modelId of modelIds) {
    try {
      console.log(`[ai-provider] ⏳ Trying ${modelId}…`);
      const start = Date.now();
      const result = await generateText({
        model: or(modelId) as LanguageModel,
        prompt,
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        abortSignal: AbortSignal.timeout(FREE_MODEL_TIMEOUT_MS),
      });

      const elapsedMs = Date.now() - start;

      if (result.text && result.text.trim().length >= opts.minLength) {
        console.log(
          `[ai-provider] ✅ ${modelId} | ${fmtElapsed(start)} | ${fmtTokens(result.usage)} | ${result.text.length} chars`,
        );
        return {
          text: result.text,
          modelUsed: modelId,
          usage: result.usage,
          elapsedMs,
        };
      }
      console.warn(
        `[ai-provider] ⚠️ ${modelId}: too short (${result.text.trim().length} chars), skipping`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      const isTransient =
        isTimeout ||
        /404|429|503|rate|No endpoints|temporarily|Provider returned error/i.test(
          msg,
        );

      console.warn(
        `[ai-provider] ❌ ${modelId}: ${isTimeout ? `timed out (${FREE_MODEL_TIMEOUT_MS / 1000}s)` : msg.slice(0, 120)}`,
      );
      if (!isTransient) break; // fatal error, stop trying free models
    }
  }

  return null; // all free models failed
}

// ─── Public API ─────────────────────────────────────────────────────────────

export type PipelineResult = {
  text: string;
  modelUsed: string;
  paid: boolean;
  elapsedMs: number;
  usage?: LanguageModelUsage;
};

/**
 * Generate article text.
 * Priority: OpenRouter free → DeepSeek (paid)
 */
export async function generateArticleText(
  prompt: string,
  opts: { maxOutputTokens?: number; temperature?: number } = {},
): Promise<PipelineResult> {
  const { maxOutputTokens = 3000, temperature = 0.55 } = opts;

  // 1. Try free models — ONLY if opted in via PIPELINE_USE_FREE_MODELS=true
  if (USE_FREE_MODELS) {
    const { write } = await getFreeModels();
    console.log(
      `[generate] 🔍 Trying ${write.length} free models for article generation…`,
    );
    const result = await tryFreeModels(write, prompt, {
      maxOutputTokens,
      temperature,
      minLength: 100,
    });
    if (result)
      return {
        text: result.text,
        modelUsed: result.modelUsed,
        paid: false,
        elapsedMs: result.elapsedMs,
        usage: result.usage,
      };
    console.warn(
      `[generate] ⚠️ All ${write.length} free models failed, falling back to paid`,
    );
  }

  // 2. DeepSeek paid (primary path when free models disabled)
  if (process.env.DEEPSEEK_API_KEY) {
    const label = `deepseek/${DEEPSEEK_MODEL}`;
    console.log(`[generate] 💰 Paid fallback: ${label}`);
    const ds = makeDeepSeekClient();
    const start = Date.now();
    const result = await generateText({
      model: ds(DEEPSEEK_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    const elapsedMs = Date.now() - start;
    console.log(
      `[generate] ✅ ${label} (PAID) | ${fmtElapsed(start)} | ${fmtTokens(result.usage)} | ${result.text.length} chars`,
    );
    return {
      text: result.text,
      modelUsed: label,
      paid: true,
      elapsedMs,
      usage: result.usage,
    };
  }

  throw new Error(
    "No AI provider configured for generation. Set OPENROUTER_API_KEY or DEEPSEEK_API_KEY.",
  );
}

/**
 * Translate text EN→ZH.
 * Priority: OpenRouter free (Qwen-first) → Kimi (paid) → DeepSeek (paid)
 */
export async function translateText(
  prompt: string,
  opts: { maxOutputTokens?: number; temperature?: number } = {},
): Promise<PipelineResult> {
  const { maxOutputTokens = 4000, temperature = 0.3 } = opts;

  // 1. Try free models — ONLY if opted in via PIPELINE_USE_FREE_MODELS=true
  if (USE_FREE_MODELS) {
    const { translate } = await getFreeModels();
    console.log(
      `[translate] 🔍 Trying ${translate.length} free models for translation…`,
    );
    const result = await tryFreeModels(translate, prompt, {
      maxOutputTokens,
      temperature,
      minLength: 50,
    });
    if (result)
      return {
        text: result.text,
        modelUsed: result.modelUsed,
        paid: false,
        elapsedMs: result.elapsedMs,
        usage: result.usage,
      };
    console.warn(
      `[translate] ⚠️ All ${translate.length} free models failed, falling back to paid`,
    );
  }

  // 2. Kimi paid fallback (better Chinese quality)
  if (process.env.KIMI_API_KEY) {
    const label = `kimi/${KIMI_MODEL}`;
    console.log(`[translate] 💰 Paid fallback: ${label}`);
    const kimi = makeKimiClient();
    const start = Date.now();
    const result = await generateText({
      model: kimi(KIMI_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    const elapsedMs = Date.now() - start;
    console.log(
      `[translate] ✅ ${label} (PAID) | ${fmtElapsed(start)} | ${fmtTokens(result.usage)} | ${result.text.length} chars`,
    );
    return {
      text: result.text,
      modelUsed: label,
      paid: true,
      elapsedMs,
      usage: result.usage,
    };
  }

  // 3. DeepSeek paid fallback
  if (process.env.DEEPSEEK_API_KEY) {
    const label = `deepseek/${DEEPSEEK_MODEL}`;
    console.log(`[translate] 💰 Paid fallback: ${label}`);
    const ds = makeDeepSeekClient();
    const start = Date.now();
    const result = await generateText({
      model: ds(DEEPSEEK_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    const elapsedMs = Date.now() - start;
    console.log(
      `[translate] ✅ ${label} (PAID) | ${fmtElapsed(start)} | ${fmtTokens(result.usage)} | ${result.text.length} chars`,
    );
    return {
      text: result.text,
      modelUsed: label,
      paid: true,
      elapsedMs,
      usage: result.usage,
    };
  }

  throw new Error(
    "No AI provider configured for translation. Set OPENROUTER_API_KEY, KIMI_API_KEY, or DEEPSEEK_API_KEY.",
  );
}

// ─── Legacy exports (backward compat for existing pipeline code) ────────────
/** @deprecated Use generateArticleText() instead */
export const articleModel = process.env.OPENROUTER_API_KEY
  ? makeOpenRouterClient()("openai/gpt-oss-120b:free")
  : process.env.DEEPSEEK_API_KEY
    ? makeDeepSeekClient()(DEEPSEEK_MODEL)
    : (() => {
        throw new Error("No AI provider configured");
      })();

/** @deprecated Use translateText() instead */
export const translationModel = process.env.OPENROUTER_API_KEY
  ? makeOpenRouterClient()("qwen/qwen3-coder:free")
  : process.env.KIMI_API_KEY
    ? makeKimiClient()(KIMI_MODEL)
    : process.env.DEEPSEEK_API_KEY
      ? makeDeepSeekClient()(DEEPSEEK_MODEL)
      : (() => {
          throw new Error("No AI provider configured");
        })();
