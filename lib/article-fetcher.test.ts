import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArticle } from "./article-fetcher";

describe("fetchArticle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return {
          ok: true,
          headers: { get: () => "text/html" },
          text: () =>
            new Promise<string>((_, reject) => {
              signal?.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            }),
        };
      }),
    );

    const result = await fetchArticle("https://example.com/slow", 5);

    expect(result.text).toBe("");
    expect(result.error).toBe("timeout after 5ms");
  });
});
