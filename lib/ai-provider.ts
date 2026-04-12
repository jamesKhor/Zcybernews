/**
 * AI Provider Factory — Free-first with paid fallback
 *
 * Generation flow:
 *   1. Fetch live free models from OpenRouter API (5-min in-process cache)
 *   2. Filter: effective params ≥ 12B, context ≥ 32k, no tiny MoE active layers
 *   3. Sort: largest effective params first (best quality first)
 *   4. Try each in order — skip on 404/429/503, stop on auth/fatal errors
 *   5. DeepSeek (paid) as absolute last resort — admin gets a warning toast
 *
 * Filtering logic for "effective params":
 *   - Parse param count from model ID (e.g. "70b" → 70, "120b" → 120)
 *   - For MoE models with "-aXb" active-param suffix, use the ACTIVE count
 *     e.g. "80b-a3b" → 3B effective (too small), "120b-a12b" → 12B (ok)
 *   - Models with no parseable size (e.g. "minimax-m2.5") are included —
 *     they are known large models but don't encode size in their name
 *   - Minimum effective params: 12B
 *   - Minimum context window: 32k (need room for 2k-token article output)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type { LanguageModel } from "ai";

// ─── Paid model IDs ───────────────────────────────────────────────────────────
export const DEEPSEEK_WRITE_MODEL = "deepseek-chat";
export const DEEPSEEK_TRANSLATE_MODEL = "deepseek-chat";
export const KIMI_WRITE_MODEL = "moonshot-v1-32k";
export const KIMI_TRANSLATE_MODEL = "moonshot-v1-32k";

// ─── Minimum thresholds for "usable" free models ─────────────────────────────
const MIN_EFFECTIVE_PARAMS_B = 12; // anything under 12B is useless for articles
const MIN_CONTEXT_LENGTH = 32_000; // need at least 32k for long prompts + output

/**
 * Extract effective parameter count (in billions) from a model ID string.
 *
 * Rules:
 *   - If the ID contains "-aXb" (active params in MoE), return X (active wins)
 *     e.g. "nemotron-3-nano-30b-a3b" → 3B (3B active, not 30B total)
 *   - Otherwise return the last explicit Xb number found in the ID
 *     e.g. "llama-3.3-70b-instruct" → 70B
 *   - If no number found, return null (unknown → include by default,
 *     these are usually known-large models like minimax-m2.5)
 */
function parseEffectiveParams(modelId: string): number | null {
  // Strip the ":free" suffix and provider prefix for cleaner matching
  const id =
    modelId
      .replace(/:free$/, "")
      .split("/")
      .pop() ?? modelId;

  // Check for MoE active-param pattern "-aXb" (X can be decimal like 3.5)
  const activeMatch = id.match(/-a(\d+(?:\.\d+)?)b(?:-|$)/i);
  if (activeMatch) {
    return parseFloat(activeMatch[1]);
  }

  // Otherwise find all "Xb" occurrences and take the last one (most relevant)
  const allMatches = [...id.matchAll(/(\d+(?:\.\d+)?)b(?:-|_|\.|$)/gi)];
  if (allMatches.length > 0) {
    return parseFloat(allMatches[allMatches.length - 1][1]);
  }

  // No size found — treat as unknown (include, these tend to be large)
  return null;
}

/**
 * Returns true if this model is usable for article generation.
 * Excludes: tiny models, MoE with tiny active layers, small context windows.
 */
function isUsableWriteModel(model: {
  id: string;
  context_length: number;
}): boolean {
  // Minimum context window — we need room for the full prompt + output
  if (model.context_length < MIN_CONTEXT_LENGTH) return false;

  const effective = parseEffectiveParams(model.id);

  // Unknown size → include (e.g. minimax/minimax-m2.5, arcee-ai/trinity-large)
  if (effective === null) return true;

  return effective >= MIN_EFFECTIVE_PARAMS_B;
}

// ─── In-process cache: live model list from OpenRouter (5-min TTL) ────────────
type CachedModelList = {
  writeModels: string[]; // sorted: largest effective params first
  translateModels: string[]; // Qwen/multilingual first, then write models
  fetchedAt: number;
};

let _modelCache: CachedModelList | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and filter live free models from OpenRouter.
 * Results cached for 5 minutes per process instance.
 */
async function getLiveFreeModels(): Promise<CachedModelList> {
  const now = Date.now();
  if (_modelCache && now - _modelCache.fetchedAt < CACHE_TTL_MS) {
    return _modelCache;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      // Don't block generation for more than 4 seconds waiting for model list
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) throw new Error(`OpenRouter models API: ${res.status}`);

    const data = (await res.json()) as {
      data: { id: string; context_length: number; name: string }[];
    };

    const freeModels = data.data.filter(
      (m) => m.id.endsWith(":free") && m.id !== "openrouter/free",
    );

    // Filter to usable models only
    const usable = freeModels.filter(isUsableWriteModel);

    // Sort by effective params descending (best quality first)
    // Unknown size models (null) go last — they're wildcards
    usable.sort((a, b) => {
      const ea = parseEffectiveParams(a.id) ?? 999; // unknown = very large, put first
      const eb = parseEffectiveParams(b.id) ?? 999;
      return eb - ea;
    });

    const writeModels = usable.map((m) => m.id);

    // Translation: prefer Qwen (best ZH), then multilingual large models
    const translateModels = [
      ...usable.filter((m) => m.id.includes("qwen")).map((m) => m.id),
      ...usable.filter((m) => !m.id.includes("qwen")).map((m) => m.id),
    ];

    console.log(
      `[ai-provider] Loaded ${writeModels.length} usable free models from OpenRouter`,
    );

    _modelCache = { writeModels, translateModels, fetchedAt: now };
    return _modelCache;
  } catch (err) {
    console.warn(
      `[ai-provider] Could not fetch OpenRouter model list (${err instanceof Error ? err.message : err}), using hardcoded fallback list`,
    );

    // Hardcoded fallback — curated list of known-good models as of Apr 2026
    // All are ≥12B effective params, confirmed usable
    const hardcodedWrite = [
      "openai/gpt-oss-120b:free", // 120B
      "nvidia/nemotron-3-super-120b-a12b:free", // 120B / 12B active
      "nousresearch/hermes-3-llama-3.1-405b:free", // 405B
      "meta-llama/llama-3.3-70b-instruct:free", // 70B
      "qwen/qwen3-coder:free", // 480B / 35B active
      "minimax/minimax-m2.5:free", // large
      "google/gemma-4-31b-it:free", // 31B
      "google/gemma-3-27b-it:free", // 27B
      "openai/gpt-oss-20b:free", // 20B
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", // 24B
      "z-ai/glm-4.5-air:free", // large
      "arcee-ai/trinity-large-preview:free", // large
      "nvidia/nemotron-nano-12b-v2-vl:free", // 12B
      "google/gemma-3-12b-it:free", // 12B
    ];

    const hardcodedTranslate = [
      "qwen/qwen3-coder:free",
      "openai/gpt-oss-120b:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-3-27b-it:free",
      "openai/gpt-oss-20b:free",
    ];

    _modelCache = {
      writeModels: hardcodedWrite,
      translateModels: hardcodedTranslate,
      fetchedAt: now,
    };
    return _modelCache;
  }
}

// ─── Provider detection ───────────────────────────────────────────────────────
export type AIProvider = "openrouter" | "deepseek" | "kimi" | "none";

export function getActiveProvider(): AIProvider {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.KIMI_API_KEY) return "kimi";
  return "none";
}

// ─── Client factories ─────────────────────────────────────────────────────────
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

// ─── Core fallback runner ─────────────────────────────────────────────────────
export type GenerateResult = {
  text: string;
  modelUsed: string;
  usedPaidFallback: boolean;
};

async function runWithFallback(
  modelIds: string[],
  prompt: string,
  minResponseLength: number,
  options: {
    maxOutputTokens: number;
    temperature: number;
    timeoutMs?: number; // per-model wall-clock timeout; skip model if exceeded
    onStatus?: (message: string, model?: string) => void;
  },
): Promise<Omit<GenerateResult, "usedPaidFallback"> & { errors: string[] }> {
  const errors: string[] = [];
  const or = makeOpenRouterClient();
  const { timeoutMs = 60_000 } = options; // default 60 s per free model

  for (const modelId of modelIds) {
    options.onStatus?.(`Trying ${modelId}…`, modelId);
    try {
      const model: LanguageModel = or(modelId);
      const result = await generateText({
        model,
        prompt,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        abortSignal: AbortSignal.timeout(timeoutMs),
      });

      if (result.text && result.text.trim().length >= minResponseLength) {
        return { text: result.text, modelUsed: modelId, errors };
      }
      errors.push(
        `${modelId}: response too short (${result.text.trim().length} chars)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Timeout — free model too slow, move on immediately
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");

      const isTransient =
        isTimeout ||
        msg.includes("404") ||
        msg.includes("429") ||
        msg.includes("503") ||
        msg.toLowerCase().includes("rate") ||
        msg.includes("No endpoints") ||
        msg.includes("temporarily") ||
        msg.includes("Provider returned error");

      errors.push(
        `${modelId}: ${isTimeout ? `timed out after ${timeoutMs / 1000}s` : msg.slice(0, 140)}`,
      );

      if (!isTransient) {
        // Fatal error (bad API key, malformed request) — stop trying OpenRouter
        break;
      }
      // Transient or timeout — try next model
    }
  }

  throw new Error(`__all_models_failed__\n${errors.join("\n")}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate article text using free OpenRouter models, falling back to DeepSeek.
 * Model list is fetched live from OpenRouter and filtered to ≥12B effective params.
 */
export async function generateWithFallback(
  prompt: string,
  options: {
    maxOutputTokens?: number;
    temperature?: number;
    provider?: "auto" | "deepseek" | "kimi";
    onStatus?: (message: string, model?: string) => void;
  } = {},
): Promise<GenerateResult> {
  const {
    maxOutputTokens = 2000,
    temperature = 0.6,
    provider = "auto",
    onStatus,
  } = options;

  // ── Direct paid model (no free queue) ──────────────────────────────────────
  if (provider === "deepseek") {
    if (!process.env.DEEPSEEK_API_KEY)
      throw new Error("DEEPSEEK_API_KEY not configured.");
    onStatus?.("Using DeepSeek…", "deepseek-chat");
    const ds = makeDeepSeekClient();
    const result = await generateText({
      model: ds(DEEPSEEK_WRITE_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `deepseek/${DEEPSEEK_WRITE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  if (provider === "kimi") {
    if (!process.env.KIMI_API_KEY)
      throw new Error("KIMI_API_KEY not configured.");
    onStatus?.("Using Kimi…", "moonshot-v1-32k");
    const kimi = makeKimiClient();
    const result = await generateText({
      model: kimi(KIMI_WRITE_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `kimi/${KIMI_WRITE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  // ── Auto: free models first, then paid fallback ─────────────────────────────
  if (process.env.OPENROUTER_API_KEY) {
    onStatus?.("Fetching available free models…");
    const { writeModels } = await getLiveFreeModels();
    onStatus?.(`Found ${writeModels.length} usable free models`);

    try {
      const result = await runWithFallback(writeModels, prompt, 100, {
        maxOutputTokens,
        temperature,
        timeoutMs: 90_000, // 90 s — long articles need time; skip if model stalls
        onStatus,
      });
      return { ...result, usedPaidFallback: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.startsWith("__all_models_failed__")) throw err;
      console.warn(
        `[ai-provider] All ${writeModels.length} free write models failed — falling back to paid API`,
      );
    }
  }

  if (process.env.DEEPSEEK_API_KEY) {
    onStatus?.("Trying DeepSeek (paid fallback)…", "deepseek-chat");
    const ds = makeDeepSeekClient();
    const result = await generateText({
      model: ds(DEEPSEEK_WRITE_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `deepseek/${DEEPSEEK_WRITE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  if (process.env.KIMI_API_KEY) {
    onStatus?.("Trying Kimi (paid fallback)…", "moonshot-v1-32k");
    const kimi = makeKimiClient();
    const result = await generateText({
      model: kimi(KIMI_WRITE_MODEL),
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `kimi/${KIMI_WRITE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  throw new Error(
    "No AI provider configured. Set OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or KIMI_API_KEY.",
  );
}

/**
 * Translate text (EN → ZH) using free OpenRouter models, falling back to DeepSeek then Kimi.
 * Uses Qwen-first ordering for best Chinese quality.
 */
export async function translateWithFallback(
  prompt: string,
  options: {
    maxOutputTokens?: number;
    temperature?: number;
    onStatus?: (message: string, model?: string) => void;
  } = {},
): Promise<GenerateResult> {
  const { maxOutputTokens = 4000, temperature = 0.3, onStatus } = options;

  if (process.env.OPENROUTER_API_KEY) {
    const { translateModels } = await getLiveFreeModels();

    try {
      const result = await runWithFallback(translateModels, prompt, 50, {
        maxOutputTokens,
        temperature,
        timeoutMs: 60_000, // 60 s per translate model
        onStatus,
      });
      return { ...result, usedPaidFallback: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.startsWith("__all_models_failed__")) throw err;
      console.warn(
        `[ai-provider] All ${translateModels.length} free translate models failed — falling back to paid API`,
      );
    }
  }

  // Kimi first for translation — better Chinese quality than DeepSeek
  if (process.env.KIMI_API_KEY) {
    const kimi = makeKimiClient();
    const model: LanguageModel = kimi(KIMI_TRANSLATE_MODEL);
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `kimi/${KIMI_TRANSLATE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  if (process.env.DEEPSEEK_API_KEY) {
    const ds = makeDeepSeekClient();
    const model: LanguageModel = ds(DEEPSEEK_TRANSLATE_MODEL);
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens,
      temperature,
    });
    return {
      text: result.text,
      modelUsed: `deepseek/${DEEPSEEK_TRANSLATE_MODEL}`,
      usedPaidFallback: true,
    };
  }

  throw new Error(
    "No AI provider configured. Set OPENROUTER_API_KEY, DEEPSEEK_API_KEY, or KIMI_API_KEY.",
  );
}

// ─── Legacy single-model getters (kept for backward compat) ──────────────────

/** @deprecated Use generateWithFallback() instead */
export function getWriteModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    return makeOpenRouterClient()("openai/gpt-oss-120b:free");
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return makeDeepSeekClient()(DEEPSEEK_WRITE_MODEL);
  }
  throw new Error("No AI provider configured.");
}

/** @deprecated Use translateWithFallback() instead */
export function getTranslateModel(): LanguageModel {
  if (process.env.OPENROUTER_API_KEY) {
    return makeOpenRouterClient()("qwen/qwen3-coder:free");
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return makeDeepSeekClient()(DEEPSEEK_TRANSLATE_MODEL);
  }
  throw new Error("No AI provider configured.");
}

export function getProviderLabel(): string {
  if (process.env.OPENROUTER_API_KEY)
    return "OpenRouter (free models, live filtered)";
  if (process.env.DEEPSEEK_API_KEY) return "DeepSeek (deepseek-chat)";
  if (process.env.KIMI_API_KEY) return "Kimi (moonshot-v1-32k)";
  return "none";
}
