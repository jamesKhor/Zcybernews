"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FeedArticle, RssSource } from "@/lib/rss/fetch";
import {
  RefreshCw,
  CheckSquare,
  Square,
  ExternalLink,
  PenLine,
  Filter,
  AlertTriangle,
  Loader2,
  Search,
} from "lucide-react";
import sourcesData from "@/data/rss-sources.json";

const categoryColors: Record<string, string> = {
  cybersecurity: "bg-red-950 text-red-400",
  tech: "bg-orange-950 text-orange-400",
  vulnerabilities: "bg-purple-950 text-purple-400",
};

const severityColors: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
};

export default function FeedReaderPage() {
  const router = useRouter();
  const sources = sourcesData as RssSource[];

  const [articles, setArticles] = useState<FeedArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeSource, setActiveSource] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loaded, setLoaded] = useState(false);

  const fetchFeed = useCallback(async (sourceId?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = sourceId && sourceId !== "all" ? `?sources=${sourceId}` : "";
      const res = await fetch(`/api/admin/feed${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { articles: FeedArticle[] };
      setArticles(data.articles);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSourceChange = (sourceId: string) => {
    setActiveSource(sourceId);
    setSelected(new Set());
    fetchFeed(sourceId);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const goCompose = () => {
    const selectedArticles = articles.filter((a) => selected.has(a.id));
    sessionStorage.setItem("compose_articles", JSON.stringify(selectedArticles));
    router.push("/admin/compose");
  };

  const filtered = articles.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.title.toLowerCase().includes(q) || a.excerpt.toLowerCase().includes(q);
  });

  const enabledSources = sources.filter((s) => s.enabled);

  return (
    <div className="flex h-full">
      {/* Source sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-gray-800 bg-gray-900/50 flex flex-col">
        <div className="px-3 py-3 border-b border-gray-800">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Sources</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
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
      </div>

      {/* Main feed area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/30">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search articles…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <button
            onClick={() => fetchFeed(activeSource)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Refresh"}
          </button>

          {selected.size > 0 && (
            <button
              onClick={goCompose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-medium transition-colors"
            >
              <PenLine className="w-3.5 h-3.5" />
              Compose with {selected.size} article{selected.size > 1 ? "s" : ""}
            </button>
          )}

          {selected.size > 0 && (
            <span className="text-xs text-gray-500">
              {5 - selected.size} more can be selected
            </span>
          )}
        </div>

        {/* Articles */}
        <div className="flex-1 overflow-y-auto">
          {!loaded && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Filter className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-sm">Select a source and click Refresh to load articles</p>
              <button
                onClick={() => fetchFeed("all")}
                className="mt-4 px-4 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-sm text-white transition-colors"
              >
                Load All Feeds
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
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
              const isSelected = selected.has(article.id);
              const canSelect = isSelected || selected.size < 5;

              return (
                <div
                  key={article.id}
                  className={`flex gap-3 px-4 py-3 transition-colors ${
                    isSelected
                      ? "bg-emerald-950/20 border-l-2 border-emerald-500"
                      : "hover:bg-gray-800/40 border-l-2 border-transparent"
                  } ${!canSelect && !isSelected ? "opacity-50" : ""}`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => canSelect && toggleSelect(article.id)}
                    disabled={!canSelect && !isSelected}
                    className="mt-0.5 flex-shrink-0"
                    title={
                      !canSelect && !isSelected
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

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${categoryColors[article.sourceCategory] ?? "bg-gray-800 text-gray-400"}`}
                        >
                          {article.sourceName}
                        </span>
                        {article.severity && (
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-medium ${severityColors[article.severity]}`}
                          >
                            {article.severity.toUpperCase()}
                          </span>
                        )}
                        <span className="text-xs text-gray-600">
                          {new Date(article.publishedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
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
                    <p className="text-sm text-white leading-snug">{article.title}</p>
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
        </div>
      </div>
    </div>
  );
}
