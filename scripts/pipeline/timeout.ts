/**
 * Wall-clock timeout helper for pipeline fetches.
 *
 * Added 2026-04-22 (Phase B A2.1 — Raymond's Stage-2 audit CRITICAL
 * finding). `rss-parser`'s internal `timeout` option is a socket-read
 * timeout; a slow-dripping origin keeps the socket alive indefinitely
 * and the library's Promise never resolves or rejects. Wrapping the
 * library Promise in this helper guarantees a wall-clock ceiling so
 * the surrounding `Promise.allSettled` cannot hang on a single feed.
 *
 * This module is PURE: no fs, network, console, state. Its only
 * side effect is the setTimeout, which is cleared on resolution.
 */

/**
 * Race `promise` against a setTimeout of `ms` ms. If the timer wins,
 * the returned Promise rejects with a clear, grep-able error whose
 * message contains `label` for log triage. If the underlying promise
 * resolves or rejects first, the timer is cleared so it does not keep
 * the Node event loop alive.
 *
 * @example
 *   const feed = await withWallClockTimeout(
 *     parser.parseURL(url),
 *     20_000,
 *     `rss ${source.id}`,
 *   );
 */
export function withWallClockTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`wall-clock timeout after ${ms}ms: ${label}`));
    }, ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}
