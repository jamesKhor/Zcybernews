"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, FileText, Shield, Loader2 } from "lucide-react";

type SearchResult = {
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  date: string;
  tags: string[];
  type: "posts" | "threat-intel";
  url: string;
};

interface Props {
  locale: string;
  /**
   * Optional controlled-open state. When provided, the parent controls
   * whether the dialog is open. Cmd+K and Esc still work but defer to
   * the parent's onOpenChange. When omitted, the dialog is fully
   * self-controlled (preserves original behavior for Header usage).
   * Phase 2 (2026-04-18) addition.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SearchDialog({
  locale,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  // If parent passes `open`, this is a controlled component. Otherwise
  // use internal state. Pattern matches shadcn/ui's controlled/uncontrolled dialogs.
  const open = controlledOpen ?? internalOpen;
  // useCallback stabilizes the setOpen reference so handleOpen/handleClose
  // below (also useCallback) don't get stale closures on re-render.
  const setOpen = useCallback(
    (value: boolean) => {
      if (onOpenChange) onOpenChange(value);
      if (controlledOpen === undefined) setInternalOpen(value);
    },
    [onOpenChange, controlledOpen],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [setOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
  }, [setOpen]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) handleClose();
        else handleOpen();
      }
      if (e.key === "Escape" && open) handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleOpen, handleClose]);

  // Arrow key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      window.location.href = results[activeIndex].url;
      handleClose();
    }
  };

  // Search via API
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&locale=${locale}`,
        );
        const data = (await res.json()) as { results: SearchResult[] };
        if (!cancelled) {
          setResults(data.results ?? []);
          setActiveIndex(-1);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, locale]);

  const isZh = locale === "zh";

  const CATEGORY_LABELS: Record<string, string> = isZh
    ? {
        "threat-intel": "威胁情报",
        vulnerabilities: "漏洞",
        malware: "恶意软件",
        industry: "行业资讯",
        tools: "工具",
        ai: "AI安全",
      }
    : {
        "threat-intel": "Threat Intel",
        vulnerabilities: "Vulnerabilities",
        malware: "Malware",
        industry: "Industry",
        tools: "Tools",
        ai: "AI Security",
      };

  return (
    <>
      {/* Desktop trigger */}
      <button
        onClick={handleOpen}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary/50 text-muted-foreground text-sm hover:bg-secondary hover:text-foreground transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="text-xs">{isZh ? "搜索" : "Search"}</span>
        <kbd className="ml-1 text-xs border border-border rounded px-1 py-0.5 bg-background">
          {typeof navigator !== "undefined" &&
          /Mac|iPhone|iPad/.test(navigator.userAgent)
            ? "⌘K"
            : "Ctrl+K"}
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

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
          role="dialog"
          aria-modal="true"
          aria-label={isZh ? "搜索文章" : "Search articles"}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          <div className="relative w-full max-w-xl bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
            {/* Input row */}
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
                onKeyDown={handleKeyDown}
                placeholder={
                  isZh
                    ? "搜索文章、威胁情报…"
                    : "Search articles, threat intel…"
                }
                className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    inputRef.current?.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Results */}
            <div ref={resultsRef} className="max-h-[420px] overflow-y-auto">
              {!query && (
                <p className="text-xs text-muted-foreground text-center py-10">
                  {isZh ? "输入关键词搜索文章" : "Type to search articles"}
                </p>
              )}

              {query && query.length < 2 && (
                <p className="text-xs text-muted-foreground text-center py-10">
                  {isZh ? "请输入至少两个字符" : "Type at least 2 characters"}
                </p>
              )}

              {query.length >= 2 && !loading && results.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-10">
                  {isZh
                    ? `未找到"${query}"相关结果`
                    : `No results for "${query}"`}
                </p>
              )}

              {results.map((r, i) => (
                <a
                  key={r.slug + r.type}
                  href={r.url}
                  onClick={handleClose}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors border-b border-border last:border-0 ${
                    i === activeIndex ? "bg-secondary" : "hover:bg-secondary/60"
                  }`}
                >
                  {r.type === "threat-intel" ? (
                    <Shield className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.title}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                      {r.excerpt}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-xs text-muted-foreground bg-secondary rounded px-1.5 py-0.5 mt-0.5">
                    {CATEGORY_LABELS[r.category] ?? r.category}
                  </span>
                </a>
              ))}
            </div>

            {/* Footer hints */}
            <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">
                  ↑↓
                </kbd>{" "}
                {isZh ? "导航" : "navigate"}
              </span>
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">
                  ↵
                </kbd>{" "}
                {isZh ? "打开" : "open"}
              </span>
              <span>
                <kbd className="border border-border rounded px-1 py-0.5 bg-secondary">
                  esc
                </kbd>{" "}
                {isZh ? "关闭" : "close"}
              </span>
              {results.length > 0 && (
                <span className="ml-auto">
                  {results.length} {isZh ? "个结果" : "results"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
