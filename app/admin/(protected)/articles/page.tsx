"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Pencil,
  Trash2,
  Shield,
  Newspaper,
  Globe,
  Loader2,
  Search,
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type ArticleRow = {
  slug: string;
  title: string;
  date: string;
  category: string;
  tags: string[];
  draft: boolean;
  type: "posts" | "threat-intel";
  hasZh: boolean;
  readingTime: number;
};

const CATEGORY_COLORS: Record<string, string> = {
  "threat-intel": "bg-red-950 text-red-400 border-red-800/40",
  vulnerabilities: "bg-orange-950 text-orange-400 border-orange-800/40",
  malware: "bg-pink-950 text-pink-400 border-pink-800/40",
  industry: "bg-blue-950 text-blue-400 border-blue-800/40",
  tools: "bg-purple-950 text-purple-400 border-purple-800/40",
  ai: "bg-emerald-950 text-emerald-400 border-emerald-800/40",
};

type FilterTab = "all" | "posts" | "threat-intel";

export default function ArticlesPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ArticleRow | null>(null);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/articles");
      const data = (await res.json()) as { articles: ArticleRow[] };
      setArticles(data.articles ?? []);
    } catch {
      toast.error("Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const filtered = articles.filter((a) => {
    if (tab !== "all" && a.type !== tab) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.title.toLowerCase().includes(q) ||
        a.category.includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)) ||
        a.slug.includes(q)
      );
    }
    return true;
  });

  async function handleDelete(article: ArticleRow) {
    setDeletingSlug(article.slug);
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/admin/articles/${article.slug}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: "en",
          type: article.type,
          deleteAll: true,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      toast.success(`Deleted "${article.title}"`);
      setArticles((prev) => prev.filter((a) => a.slug !== article.slug));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed", {
        duration: Infinity,
      });
    } finally {
      setDeletingSlug(null);
    }
  }

  const publicUrl = (a: ArticleRow, locale = "en") =>
    `/${locale}/${a.type === "threat-intel" ? "threat-intel" : "articles"}/${a.slug}`;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Articles</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {articles.length} published ·{" "}
            {articles.filter((a) => a.hasZh).length} with ZH
          </p>
        </div>
        <Link
          href="/admin/compose"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
        >
          + New Article
        </Link>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-0.5 gap-0.5">
          {(["all", "posts", "threat-intel"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                tab === t
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t === "all" ? "All" : t === "posts" ? "Posts" : "Threat Intel"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, tag, category…"
            className="pl-8 h-8 text-sm bg-gray-900 border-gray-700"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500 text-sm">
          No articles found.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((article) => (
            <div
              key={`${article.type}-${article.slug}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors group"
            >
              {/* Type icon */}
              <div className="flex-shrink-0 text-gray-600">
                {article.type === "threat-intel" ? (
                  <Shield className="w-4 h-4 text-red-500/60" />
                ) : (
                  <Newspaper className="w-4 h-4 text-blue-500/60" />
                )}
              </div>

              {/* Title + meta */}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate font-medium">
                  {article.title}
                  {article.draft && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-400 font-mono">
                      draft
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-500">
                    {new Date(article.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[article.category] ?? "bg-gray-800 text-gray-400 border-gray-700"}`}
                  >
                    {article.category}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 font-mono">
                    EN
                  </span>
                  {article.hasZh && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 font-mono">
                      ZH
                    </span>
                  )}
                  {article.readingTime > 0 && (
                    <span className="text-xs text-gray-600">
                      {article.readingTime} min read
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* View EN */}
                <a
                  href={publicUrl(article, "en")}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View EN article"
                  className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {/* View ZH */}
                {article.hasZh && (
                  <a
                    href={publicUrl(article, "zh")}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View ZH article"
                    className="p-1.5 rounded text-gray-500 hover:text-purple-400 hover:bg-gray-800 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" />
                  </a>
                )}

                {/* Edit */}
                <Link
                  href={`/admin/articles/${article.slug}/edit?type=${article.type}`}
                  title="Edit article"
                  className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-gray-800 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Link>

                {/* Delete */}
                <button
                  onClick={() => setConfirmDelete(article)}
                  disabled={deletingSlug === article.slug}
                  title="Delete article"
                  className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {deletingSlug === article.slug ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-950 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Delete Article
                </h2>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                  &ldquo;{confirmDelete.title}&rdquo;
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-400">
              This will permanently remove the article from GitHub. This cannot
              be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-2 rounded-md border border-gray-700 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-3 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
