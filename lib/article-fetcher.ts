/**
 * Article fetcher — pulls the HTML of a URL and extracts the main
 * article text as plain text. No new dependencies (no jsdom/readability).
 *
 * Goal: give the LLM enough real source material to ground its
 * generation in facts, without hallucination.
 *
 * Used by the admin "Research & Write" compose mode. Called for each
 * Brave search result to get fuller context than the 200-char snippet.
 *
 * Strategy (in order):
 *   1. Fetch HTML with a realistic User-Agent (some sites block bots)
 *   2. Strip scripts, styles, nav, footer, header, aside, ads
 *   3. Prefer <article>, then <main>, then <div class*="article|content|post|entry">
 *   4. Fall back to whole <body> if no specific container matches
 *   5. Strip remaining HTML tags; collapse whitespace
 *   6. Cap at MAX_CHARS to avoid LLM token blowup
 *
 * Principle: deterministic, no LLM. Good enough for 80% of news sites.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CHARS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type FetchedArticle = {
  url: string;
  title: string;
  text: string;
  /** Non-null if fetch or parse failed; caller decides whether to skip */
  error?: string;
};

export async function fetchArticle(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FetchedArticle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        url,
        title: url,
        text: "",
        error: `HTTP ${res.status}`,
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      return {
        url,
        title: url,
        text: "",
        error: `Non-HTML content-type: ${contentType}`,
      };
    }

    const html = await res.text();
    return extractArticle(url, html);
  } catch (err) {
    clearTimeout(timer);
    const message =
      (err as Error).name === "AbortError"
        ? `timeout after ${timeoutMs}ms`
        : ((err as Error).message ?? "fetch failed");
    return { url, title: url, text: "", error: message };
  }
}

/**
 * Extract title + main article text from raw HTML. Exported for testing.
 */
export function extractArticle(url: string, html: string): FetchedArticle {
  // Remove low-value elements entirely before content detection
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, " ")
    // strip HTML comments
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Extract title — prefer <title>, fall back to first <h1>
  let title = url;
  const titleMatch = cleaned.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = decodeEntities(titleMatch[1].trim());
  } else {
    const h1Match = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      title = decodeEntities(stripTags(h1Match[1]).trim());
    }
  }

  // Try content selectors in order of preference
  const containers = [
    // Semantic HTML5
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    // Common class/id patterns
    /<div[^>]+(?:class|id)="[^"]*(?:article-body|article__body|post-body|entry-content|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+(?:class|id)="[^"]*(?:article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  let mainHtml = "";
  for (const re of containers) {
    const m = cleaned.match(re);
    if (m && m[1].length > 200) {
      mainHtml = m[1];
      break;
    }
  }

  // Fallback: body content
  if (!mainHtml) {
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    mainHtml = bodyMatch ? bodyMatch[1] : cleaned;
  }

  // Strip remaining HTML tags and collapse whitespace
  let text = stripTags(mainHtml);
  text = decodeEntities(text);
  text = text.replace(/\s+/g, " ").trim();

  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS).replace(/\s+\S*$/, "") + "...";
  }

  return { url, title, text };
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    );
}
