import pLimit from "p-limit";

/** Concurrency-limited async runner with exponential backoff retry. */
export const limit = pLimit(3);

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
