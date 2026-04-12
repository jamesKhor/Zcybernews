/**
 * Wrapper for admin API fetch calls — adds CSRF header automatically.
 */
export async function adminFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");
  return fetch(url, { ...options, headers });
}
