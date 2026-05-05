declare module "/pagefind/pagefind.js" {
  export interface PagefindSearchResult {
    url: string;
    meta: {
      title?: string;
      excerpt?: string;
      slug?: string;
      category?: string;
      date?: string;
      tags?: string;
      type?: string;
      [key: string]: string | undefined;
    };
    excerpt?: string;
  }
  export interface PagefindResult {
    data: () => Promise<PagefindSearchResult>;
  }
  export interface PagefindSearchResponse {
    results: PagefindResult[];
  }
  export function init(): Promise<void>;
  export function search(
    query: string,
    options?: { filters?: Record<string, string | string[]> },
  ): Promise<PagefindSearchResponse>;
}
