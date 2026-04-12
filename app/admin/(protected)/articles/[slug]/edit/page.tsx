"use client";

import { useState, useEffect, useCallback, use } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, ExternalLink, X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const CATEGORIES = [
  "threat-intel",
  "vulnerabilities",
  "malware",
  "industry",
  "tools",
  "ai",
] as const;

type ArticleData = {
  sha: string;
  html_url: string;
  frontmatter: {
    title: string;
    slug: string;
    date: string;
    excerpt: string;
    category: string;
    tags: string[];
    language: string;
    draft: boolean;
    author: string;
    [key: string]: unknown;
  };
  body: string;
};

export default function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get("type") ?? "posts";

  // We always edit EN as the canonical source
  const locale = "en";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ArticleData | null>(null);

  // Form fields
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draft, setDraft] = useState(false);
  const [body, setBody] = useState("");
  const [activeTab, setActiveTab] = useState<"meta" | "content">("meta");

  const fetchArticle = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/articles/${slug}?locale=${locale}&type=${type}`,
      );
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        throw new Error(err.error ?? "Failed to load article");
      }
      const article = (await res.json()) as ArticleData;
      setData(article);
      setTitle(article.frontmatter.title ?? "");
      setExcerpt(article.frontmatter.excerpt ?? "");
      setCategory(article.frontmatter.category ?? "threat-intel");
      setTags(article.frontmatter.tags ?? []);
      setDraft(article.frontmatter.draft ?? false);
      setBody(article.body ?? "");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load article",
        {
          duration: Infinity,
        },
      );
    } finally {
      setLoading(false);
    }
  }, [slug, locale, type]);

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          type,
          frontmatter: { title, excerpt, category, tags, draft },
          body,
        }),
      });
      const result = (await res.json()) as {
        success: boolean;
        error?: string;
        html_url?: string;
      };
      if (!res.ok) throw new Error(result.error ?? "Save failed");
      toast.success("Article updated! Vercel will redeploy shortly.");
      router.push("/admin/articles");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed", {
        duration: Infinity,
      });
    } finally {
      setSaving(false);
    }
  }

  const publicUrl = `/${locale}/${type === "threat-intel" ? "threat-intel" : "articles"}/${slug}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading article…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm">
        Article not found.{" "}
        <Link
          href="/admin/articles"
          className="text-emerald-400 hover:underline"
        >
          Back to Articles
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/articles"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Articles
          </Link>
          <span className="text-gray-700">/</span>
          <span className="text-sm text-white truncate max-w-xs">
            {title || slug}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-md border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View
          </a>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-6 bg-gray-950 flex-shrink-0">
        {(["meta", "content"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              activeTab === t
                ? "border-emerald-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t === "meta" ? "Metadata" : "Content"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "meta" ? (
          <div className="max-w-2xl space-y-5">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-gray-300 text-sm">
                Title
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Article title"
                className="bg-gray-900 border-gray-700 text-white"
              />
            </div>

            {/* Excerpt */}
            <div className="space-y-1.5">
              <Label htmlFor="excerpt" className="text-gray-300 text-sm">
                Excerpt
              </Label>
              <Textarea
                id="excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Short description shown in article cards…"
                rows={3}
                className="bg-gray-900 border-gray-700 text-white resize-none"
              />
              <p className="text-xs text-gray-500">
                {excerpt.length}/200 chars
              </p>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-gray-900 border-gray-700 text-white w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {CATEGORIES.map((c) => (
                    <SelectItem
                      key={c}
                      value={c}
                      className="text-gray-300 hover:text-white"
                    >
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Tags</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Add tag (Enter or comma)"
                  className="bg-gray-900 border-gray-700 text-white text-sm h-8"
                />
                <button
                  onClick={addTag}
                  className="px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Draft toggle */}
            <div className="flex items-center gap-3 pt-1">
              <button
                role="switch"
                aria-checked={draft}
                onClick={() => setDraft((d) => !d)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  draft ? "bg-yellow-500" : "bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    draft ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <Label
                className="text-gray-300 text-sm cursor-pointer"
                onClick={() => setDraft((d) => !d)}
              >
                Draft (hidden from public)
              </Label>
            </div>

            {/* Info */}
            <div className="pt-2 border-t border-gray-800 text-xs text-gray-500 space-y-1">
              <p>
                Slug:{" "}
                <span className="text-gray-400 font-mono">
                  {data.frontmatter.slug}
                </span>
              </p>
              <p>
                Published:{" "}
                <span className="text-gray-400">{data.frontmatter.date}</span>
              </p>
              <p>
                Language:{" "}
                <span className="text-gray-400 font-mono">
                  {data.frontmatter.language}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Edit raw MDX content. Markdown and MDX syntax supported.
            </p>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={30}
              spellCheck={false}
              className="bg-gray-900 border-gray-700 text-gray-200 font-mono text-sm resize-none w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
