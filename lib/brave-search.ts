/**
 * Brave Search API wrapper.
 *
 * Thin HTTP client for Brave's Web Search REST API. Used by the
 * admin "Research & Write" compose mode to find source articles
 * for a user-supplied keyword query.
 *
 * Docs: https://brave.com/search/api/
 * Free tier: 2,000 queries/month (plenty for solo operator).
 *
 * Principle: deterministic script (no LLM tokens for search).
 */

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export type BraveSearchResult = {
  title: string;
  url: string;
  /** Brave returns a short snippet ~200 chars; used as excerpt fallback */
  description: string;
  /** ISO 8601 from Brave if available (may be absent for evergreen pages) */
  age?: string;
};

export type BraveSearchOptions = {
  /** 1–20; default 10 */
  count?: number;
  /** ISO country code like "us"; default from env or "us" */
  country?: string;
  /** Restrict by freshness: pd (past day), pw (past week), pm (past month), py (past year) */
  freshness?: "pd" | "pw" | "pm" | "py";
  /** Timeout in ms; default 10_000 */
  timeoutMs?: number;
};

export class BraveSearchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BraveSearchError";
  }
}

/**
 * Search Brave Web Search. Returns up to `count` results (default 10).
 * Throws BraveSearchError for missing API key, HTTP errors, or timeouts.
 */
export async function searchBrave(
  query: string,
  options: BraveSearchOptions = {},
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new BraveSearchError(
      "BRAVE_SEARCH_API_KEY not configured in environment",
    );
  }

  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new BraveSearchError("Query cannot be empty");
  }
  if (cleanQuery.length > 400) {
    // Brave limit is 400 chars; truncate defensively
    throw new BraveSearchError("Query too long (max 400 chars)");
  }

  const params = new URLSearchParams({
    q: cleanQuery,
    count: String(Math.min(20, Math.max(1, options.count ?? 10))),
    country: options.country ?? "us",
    safesearch: "moderate",
    // result_filter: only web results (no videos/news/etc)
    result_filter: "web",
  });
  if (options.freshness) {
    params.set("freshness", options.freshness);
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BRAVE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new BraveSearchError(`Brave search timed out after ${timeoutMs}ms`);
    }
    throw new BraveSearchError(
      `Brave search network error: ${(err as Error).message}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BraveSearchError(
      `Brave search HTTP ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string;
      }>;
    };
  };

  const raw = data.web?.results ?? [];
  return raw
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: stripHtmlTags(String(r.title)),
      url: String(r.url),
      description: stripHtmlTags(String(r.description ?? "")),
      age: r.age,
    }));
}

/**
 * Brave wraps matched terms in <strong> tags in titles/descriptions.
 * Strip them for clean plaintext use.
 */
function stripHtmlTags(s: string): string {
  return s
    .replace(/<\/?strong>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}
