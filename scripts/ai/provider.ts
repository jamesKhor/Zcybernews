import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
});

const kimi = createOpenAICompatible({
  name: "kimi",
  baseURL: "https://api.moonshot.cn/v1",
  apiKey: process.env.KIMI_API_KEY ?? "",
});

/** DeepSeek-V3 — primary article generation (~$0.27/1M tokens) */
export const articleModel = deepseek("deepseek-chat");

/** Kimi K2 — Chinese translation (better ZH quality) */
export const translationModel = kimi("moonshot-v1-32k");
