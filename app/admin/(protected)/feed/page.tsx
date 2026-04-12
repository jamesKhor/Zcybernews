"use client";

import { useState, useCallback, useRef } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import { useRouter } from "next/navigation";
import type { FeedArticle, RssSource } from "@/lib/rss/fetch";
import {
  RefreshCw,
  CheckSquare,
  Square,
  ExternalLink,
  PenLine,
  AlertTriangle,
  Search,
  X,
  ShoppingBag,
} from "lucide-react";
import sourcesData from "@/data/rss-sources.json";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const categoryColors: Record<string, string> = {
  cybersecurity: "bg-red-950 text-red-400",
  tech: "bg-orange-950 text-orange-400",
  vulnerabilities: "bg-purple-950 text-purple-400",
};

// Avatar dot colors by source category
const categoryDotColors: Record<string, string> = {
  cybersecurity: "bg-red-500",
  tech: "bg-orange-400",
  vulnerabilities: "bg-purple-500",
};

const severityColors: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
};

function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function ArticleSkeleton() {
  return (
    <div className="p-3 border-b border-gray-800 space-y-2">
      <Skeleton className="h-4 w-3/4 bg-gray-800" />
      <Skeleton className="h-3 w-1/2 bg-gray-800" />
      <Skeleton className="h-3 w-full bg-gray-800" />
    </div>
  );
}

export default function FeedReaderPage() {
  const router = useRouter();
  const sources = sourcesData as RssSource[];
  const enabledSources = sources.filter((s) => s.enabled);

  // Per-source article cache: sourceId → FeedArticle[]
  const articleCache = useRef<Map<string, FeedArticle[]>>(new Map());

  // Persisted selection across all sources: articleId → FeedArticle
  const [selectedMap, setSelectedMap] = useState<Map<string, FeedArticle>>(
    new Map(),
  );

  // Current displayed articles (from cache for active source)
  const [displayedArticles, setDisplayedArticles] = useState<FeedArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeSource, setActiveSource] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchFeed = useCallback(
    async (sourceId: string, forceRefresh = false) => {
      if (!forceRefresh && articleCache.current.has(sourceId)) {
        const cached = articleCache.current.get(sourceId)!;
        setDisplayedArticles(cached);
        setLoaded(true);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const params = sourceId !== "all" ? `?sources=${sourceId}` : "";
        const res = await adminFetch(`/api/admin/feed${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { articles: FeedArticle[] };
        articleCache.current.set(sourceId, data.articles);
        setDisplayedArticles(data.articles);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load feed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleSourceChange = (sourceId: string) => {
    setActiveSource(sourceId);
    setSearchQuery("");
    fetchFeed(sourceId);
  };

  const toggleSelect = (article: FeedArticle) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(article.id)) {
        next.delete(article.id);
      } else if (next.size < 5) {
        next.set(article.id, article);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedMap(new Map());

  const goCompose = () => {
    sessionStorage.setItem(
      "compose_articles",
      JSON.stringify(Array.from(selectedMap.values())),
    );
    router.push("/admin/compose");
  };

  const filtered = displayedArticles.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q)
    );
  });

  const selectedCount = selectedMap.size;
  const selectedList = Array.from(selectedMap.values());

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* Source sidebar */}
        <div className="w-44 flex-shrink-0 border-r border-gray-800 bg-gray-900/50 flex flex-col">
          <div className="px-3 py-3 border-b border-gray-800">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Sources
            </p>
          </div>
          <ScrollArea className="flex-1">
            <nav className="px-2 py-2 space-y-0.5">
              <button
                onClick={() => handleSourceChange("all")}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                  activeSource === "all"
                    ? "bg-emerald-900/60 text-emerald-300"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`}
              >
                All Sources
              </button>
              {enabledSources.map((source) => (
                <button
                  key={source.id}
                  onClick={() => handleSourceChange(source.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors leading-tight ${
                    activeSource === source.id
                      ? "bg-emerald-900/60 text-emerald-300"
                      : "text-gray-400 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  {source.name}
                </button>
              ))}
            </nav>
          </ScrollArea>
        </div>

        {/* Main feed area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/30 flex-wrap shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 z-10" />
              <Input
                type="text"
                placeholder="Search articles…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 h-auto rounded-md bg-gray-800 border-gray-700 text-xs text-white placeholder-gray-500 focus-visible:ring-emerald-500"
              />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => fetchFeed(activeSource, true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                  {loading ? "Loading…" : "Refresh"}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh feed</p>
              </TooltipContent>
            </Tooltip>

            {selectedCount < 5 && selectedCount > 0 && (
              <span className="text-xs text-gray-500 ml-auto">
                {5 - selectedCount} slot{5 - selectedCount !== 1 ? "s" : ""}{" "}
                left
              </span>
            )}
          </div>

          {/* Article list — shrinks to make room for the tray */}
          <ScrollArea className="flex-1 min-h-0">
            {!loaded && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-16">
                <p className="text-sm">
                  Select a source or load all feeds to get started
                </p>
                <button
                  onClick={() => fetchFeed("all")}
                  className="mt-4 px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-sm text-white transition-colors"
                >
                  Load All Feeds
                </button>
              </div>
            )}

            {loading && (
              <div className="divide-y divide-gray-800/60">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ArticleSkeleton key={i} />
                ))}
              </div>
            )}

            {error && (
              <div className="m-4 flex items-center gap-2 rounded-lg bg-red-950/30 border border-red-800 p-4 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {!loading && loaded && filtered.length === 0 && (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                No articles found
              </div>
            )}

            <div className="divide-y divide-gray-800/60">
              {filtered.map((article) => {
                const isSelected = selectedMap.has(article.id);
                const canSelect = isSelected || selectedCount < 5;

                return (
                  <div
                    key={article.id}
                    className={`flex gap-3 px-4 py-3 transition-colors ${
                      isSelected
                        ? "bg-emerald-950/20 border-l-2 border-emerald-500"
                        : "hover:bg-gray-800/40 border-l-2 border-transparent"
                    } ${!canSelect ? "opacity-40" : ""}`}
                  >
                    <button
                      onClick={() => canSelect && toggleSelect(article)}
                      disabled={!canSelect}
                      className="mt-0.5 flex-shrink-0"
                      title={
                        !canSelect
                          ? "Max 5 articles per synthesis"
                          : isSelected
                            ? "Deselect"
                            : "Select for synthesis"
                      }
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-600" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <Badge
                            variant="outline"
                            className={`text-xs px-1.5 py-0.5 rounded border-0 ${categoryColors[article.sourceCategory] ?? "bg-gray-800 text-gray-400"}`}
                          >
                            {article.sourceName}
                          </Badge>
                          {article.severity && (
                            <Badge
                              variant="outline"
                              className={`text-xs px-1.5 py-0.5 rounded border-0 font-medium ${severityColors[article.severity]}`}
                            >
                              {article.severity.toUpperCase()}
                            </Badge>
                          )}
                          <span className="text-xs text-gray-600">
                            {new Date(article.publishedAt).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </span>
                        </div>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 text-gray-600 hover:text-emerald-400 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <p className="text-sm text-white leading-snug">
                        {article.title}
                      </p>
                      {article.excerpt && (
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed line-clamp-2">
                          {article.excerpt}
                        </p>
                      )}
                      {article.tags && article.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {article.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* ── Selection Tray ── always visible at the bottom */}
          <div
            className={`shrink-0 border-t border-gray-800 bg-gray-900/80 backdrop-blur-sm transition-all duration-300 ${
              selectedCount > 0 ? "py-3" : "py-2"
            }`}
          >
            <div className="px-4 flex items-center gap-3">
              {/* Bucket icon + label */}
              <div className="flex items-center gap-1.5 shrink-0">
                <ShoppingBag
                  className={`w-4 h-4 transition-colors ${selectedCount > 0 ? "text-emerald-400" : "text-gray-600"}`}
                />
                <span
                  className={`text-xs font-medium transition-colors ${selectedCount > 0 ? "text-emerald-400" : "text-gray-600"}`}
                >
                  {selectedCount}/5
                </span>
              </div>

              {/* Empty state */}
              {selectedCount === 0 && (
                <p className="text-xs text-gray-600 italic">
                  Tick articles to add them here — selections persist across
                  sources
                </p>
              )}

              {/* Article chips — horizontal scroll area */}
              <ScrollArea className="flex-1 min-w-0 w-full">
                <div className="flex items-center gap-2 pb-0.5">
                  {selectedList.map((article) => (
                    <div
                      key={article.id}
                      className="group flex items-center gap-2 shrink-0 rounded-lg bg-gray-800 border border-gray-700 hover:border-emerald-700 px-2.5 py-1.5 transition-colors max-w-[200px]"
                      title={article.title}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${
                          categoryDotColors[article.sourceCategory] ??
                          "bg-gray-600"
                        }`}
                      >
                        {getInitials(article.title)}
                      </div>
                      {/* Title + source */}
                      <div className="min-w-0">
                        <p className="text-xs text-white truncate leading-tight max-w-[120px]">
                          {article.title}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate leading-tight">
                          {article.sourceName}
                        </p>
                      </div>
                      {/* Remove */}
                      <button
                        onClick={() => toggleSelect(article)}
                        className="shrink-0 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              {/* Actions */}
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <button
                    onClick={clearSelection}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Clear
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={goCompose}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors"
                      >
                        <PenLine className="w-3.5 h-3.5" />
                        Compose
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Open compose with selected articles</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
