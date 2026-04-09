"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, FileText, Loader2 } from "lucide-react";

type PagefindResult = {
  url: string;
  meta: { title?: string };
  excerpt: string;
};

type PagefindAPI = {
  search: (query: string) => Promise<{
    results: Array<{ data: () => Promise<PagefindResult> }>;
  }>;
};

declare global {
  interface Window {
    pagefind?: PagefindAPI;
  }
}

interface Props {
  locale: string;
}

export function SearchDialog({ locale }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PagefindResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pagefindLoaded = useRef(false);

  // Load pagefind lazily when dialog opens
  const loadPagefind = useCallback(async () => {
    if (pagefindLoaded.current || window.pagefind) return;
    try {
      // Dynamic import via Function to bypass TS static module resolution.
      // Pagefind is generated at build time and served from /pagefind/pagefind.js.
      const dynamicImport = new Function("path", "return import(path)");
      const pf = (await dynamicImport("/pagefind/pagefind.js")) as
        | ({ default?: PagefindAPI } & PagefindAPI)
        | undefined;
      if (pf) window.pagefind = pf.default ?? pf;
      pagefindLoaded.current = true;
    } catch {
      // Pagefind not available in dev mode — expected
    }
  }, []);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    await loadPagefind();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [loadPagefind]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open ? handleClose() : handleOpen();
      }
      if (e.key === "Escape" && open) handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleOpen, handleClose]);

  // Search on query change
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        if (!window.pagefind) await loadPagefind();
        if (!window.pagefind) {
          setResults([]);
          setLoading(false);
          return;
        }
        const search = await window.pagefind.search(query);
        const resolved = await Promise.all(
          search.results.slice(0, 8).map((r) => r.data())
        );
        if (!cancelled) setResults(resolved);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = setTimeout(run, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, loadPagefind]);

  const label = locale === "zh" ? "搜索…" : "Search…";
  const shortcut = locale === "zh" ? "搜索" : "Search";

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={handleOpen}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary/50 text-muted-foreground text-sm hover:bg-secondary hover:text-foreground transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="text-xs">{shortcut}</span>
        <kbd className="ml-1 text-xs border border-border rounded px-1 py-0.5 bg-background">
          ⌘K
        </kbd>
      </button>

      {/* Mobile icon */}
      <button
        onClick={handleOpen}
        className="md:hidden p-2 rounded hover:bg-secondary transition-colors text-muted-foreground"
        aria-label="Search"
      >
        <Search className="w-5 h-5" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

          <div className="relative w-full max-w-xl bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              {loading ? (
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
              ) : (
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={label}
                className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
              <button
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {!query && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  {locale === "zh" ? "输入关键词搜索文章" : "Type to search articles"}
                </p>
              )}

              {query && results.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  {locale === "zh" ? `没有找到 "${query}" 的结果` : `No results for "${query}"`}
                </p>
              )}

              {results.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  onClick={handleClose}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-secondary transition-colors border-b border-border last:border-0"
                >
                  <FileText className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {r.meta.title ?? "Article"}
                    </p>
                    <p
                      className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: r.excerpt }}
                    />
                  </div>
                </a>
              ))}
            </div>

            <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">↑↓</kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">↵</kbd>{" "}
                open
              </span>
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">esc</kbd>{" "}
                close
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
