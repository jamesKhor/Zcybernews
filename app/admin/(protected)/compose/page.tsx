"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FeedArticle } from "@/lib/rss/fetch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  X,
  ExternalLink,
  Plus,
  ClipboardPaste,
  Newspaper,
  Eye,
  Code2,
  Save,
  Trash2,
  Languages,
} from "lucide-react";

type SuggestedMeta = {
  title: string;
  slug: string;
  category: string;
  tags: string[];
  excerpt: string;
};

type PublishResult = {
  success: boolean;
  githubUrl?: string;
  enGithubUrl?: string;
  zhGithubUrl?: string;
  error?: string;
};

type PasteBlock = {
  id: string;
  label: string;
  text: string;
};

const CATEGORIES = [
  "threat-intel",
  "vulnerabilities",
  "malware",
  "industry",
  "tools",
  "ai",
];

const DRAFT_KEY = "alecybernews_compose_draft";

function newPasteBlock(): PasteBlock {
  return { id: crypto.randomUUID(), label: "", text: "" };
}

type DraftData = {
  title: string;
  slug: string;
  category: string;
  tags: string;
  excerpt: string;
  content: string;
  articleType: "posts" | "threat-intel";
  savedAt: number;
};

export default function ComposePage() {
  // Feed mode state
  const [sourceArticles, setSourceArticles] = useState<FeedArticle[]>([]);

  // Paste mode state
  const [pasteBlocks, setPasteBlocks] = useState<PasteBlock[]>([newPasteBlock()]);

  // Shared generation state
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishingBoth, setPublishingBoth] = useState(false);
  const [genError, setGenError] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [targetLength, setTargetLength] = useState<"short" | "medium" | "long">("medium");

  // Generated content state
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("threat-intel");
  const [tags, setTags] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [articleType, setArticleType] = useState<"posts" | "threat-intel">("posts");

  // UI state
  const [previewMode, setPreviewMode] = useState<"edit" | "preview">("edit");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  // Load from sessionStorage (feed articles) + localStorage (draft)
  useEffect(() => {
    const stored = sessionStorage.getItem("compose_articles");
    if (stored) {
      try { setSourceArticles(JSON.parse(stored) as FeedArticle[]); } catch {}
    }

    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const d = JSON.parse(draft) as DraftData;
        if (d.content || d.title) {
          setTitle(d.title ?? "");
          setSlug(d.slug ?? "");
          setCategory(d.category ?? "threat-intel");
          setTags(d.tags ?? "");
          setExcerpt(d.excerpt ?? "");
          setContent(d.content ?? "");
          setArticleType(d.articleType ?? "posts");
          setDraftSavedAt(d.savedAt ?? null);
        }
      } catch {}
    }
  }, []);

  // Auto-save draft to localStorage (debounced 2s)
  const saveDraft = useCallback(() => {
    if (!content && !title) return;
    const draft: DraftData = { title, slug, category, tags, excerpt, content, articleType, savedAt: Date.now() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setDraftSavedAt(Date.now());
  }, [title, slug, category, tags, excerpt, content, articleType]);

  useEffect(() => {
    const timer = setTimeout(saveDraft, 2000);
    return () => clearTimeout(timer);
  }, [saveDraft]);

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setTitle(""); setSlug(""); setCategory("threat-intel"); setTags("");
    setExcerpt(""); setContent(""); setDraftSavedAt(null);
    setGenError("");
  };

  const removeSource = (id: string) => setSourceArticles((prev) => prev.filter((a) => a.id !== id));

  const addPasteBlock = () => { if (pasteBlocks.length < 5) setPasteBlocks((prev) => [...prev, newPasteBlock()]); };
  const removePasteBlock = (id: string) => { if (pasteBlocks.length > 1) setPasteBlocks((prev) => prev.filter((b) => b.id !== id)); };
  const updatePasteBlock = (id: string, field: keyof PasteBlock, value: string) => {
    setPasteBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  const handleGenerate = async (mode: "feed" | "paste") => {
    if (mode === "feed" && sourceArticles.length === 0) { setGenError("Add at least one source article from the Feed Reader."); return; }
    if (mode === "paste" && !pasteBlocks.some((b) => b.text.trim())) { setGenError("Paste at least one article text."); return; }

    setGenerating(true); setGenError("");

    try {
      const body = mode === "feed"
        ? { articles: sourceArticles, targetLength, customPrompt: customPrompt.trim() || undefined }
        : { pastedTexts: pasteBlocks.filter((b) => b.text.trim()).map((b) => ({ label: b.label.trim() || "Source", text: b.text.trim() })), targetLength, customPrompt: customPrompt.trim() || undefined };

      const res = await fetch("/api/admin/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { content?: string; suggested?: SuggestedMeta; error?: string };

      if (!res.ok || data.error) { setGenError(data.error ?? "Generation failed"); return; }

      setContent(data.content ?? "");
      if (data.suggested) {
        setTitle(data.suggested.title);
        setSlug(data.suggested.slug);
        setCategory(data.suggested.category);
        setTags(data.suggested.tags.join(", "));
        setExcerpt(data.suggested.excerpt);
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!content || !title || !slug) {
      toast.error("Publish failed", { description: "Title, slug and content are required." });
      return;
    }
    setPublishing(true);

    try {
      const res = await fetch("/api/admin/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug, content, excerpt, category, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), locale: "en", type: articleType }),
      });
      const data = (await res.json()) as PublishResult & { message?: string };
      if (!res.ok) {
        toast.error("Publish failed", { description: data.error });
      } else {
        toast.success("Published! Vercel is deploying.", {
          description: "View on GitHub",
          action: data.githubUrl
            ? { label: "Open", onClick: () => window.open(data.githubUrl, "_blank") }
            : undefined,
        });
        localStorage.removeItem(DRAFT_KEY);
        setDraftSavedAt(null);
      }
    } catch (err) {
      toast.error("Publish failed", { description: err instanceof Error ? err.message : "Network error" });
    } finally {
      setPublishing(false);
    }
  };

  const handlePublishBoth = async () => {
    if (!content || !title || !slug) {
      toast.error("Publish failed", { description: "Title, slug and content are required." });
      return;
    }
    setPublishingBoth(true);

    try {
      const res = await fetch("/api/admin/translate-publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, slug, content, excerpt, category, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), type: articleType }),
      });
      const data = (await res.json()) as { success?: boolean; enGithubUrl?: string; zhGithubUrl?: string; error?: string };
      if (!res.ok || data.error) {
        toast.error("Publish failed", { description: data.error });
      } else {
        toast.success("Published EN + ZH!", { description: "Both versions committed to GitHub" });
        localStorage.removeItem(DRAFT_KEY);
        setDraftSavedAt(null);
      }
    } catch (err) {
      toast.error("Publish failed", { description: err instanceof Error ? err.message : "Network error" });
    } finally {
      setPublishingBoth(false);
    }
  };

  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;

  const SettingsPanel = ({ mode }: { mode: "feed" | "paste" }) => (
    <div className="px-4 py-4 border-t border-gray-800 space-y-3">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Settings</p>

      <div className="space-y-1">
        <Label className="text-xs text-gray-500">Length</Label>
        <Select value={targetLength} onValueChange={(v) => setTargetLength(v as typeof targetLength)}>
          <SelectTrigger className="bg-gray-800 border-gray-700 text-xs text-white h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="short" className="text-xs text-white">Short (400–600 words)</SelectItem>
            <SelectItem value="medium" className="text-xs text-white">Medium (700–900 words)</SelectItem>
            <SelectItem value="long" className="text-xs text-white">Long (1000–1300 words)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-gray-500">
          Additional instructions <span className="text-gray-600">(optional)</span>
        </Label>
        <Textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. Focus on healthcare impact. Include detection queries. More technical tone."
          className="w-full bg-gray-800 border-gray-700 text-xs text-white placeholder-gray-600 focus-visible:ring-emerald-500 resize-none leading-relaxed"
        />
      </div>

      <button onClick={() => handleGenerate(mode)} disabled={generating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium text-white transition-colors">
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {generating ? "Generating…" : "Generate with AI"}
      </button>

      {genError && (
        <div className="flex items-start gap-2 rounded-md bg-red-950/40 border border-red-800 p-3 text-xs text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{genError}
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0">
        {/* Left panel */}
        <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900/30">
          <Tabs defaultValue="feed" className="flex flex-col flex-1 min-h-0">
            <TabsList className="w-full rounded-none border-b border-gray-800 bg-gray-900/60 h-10 px-2 shrink-0">
              <TabsTrigger value="feed" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">
                <Newspaper className="w-3.5 h-3.5" />From Feed
              </TabsTrigger>
              <TabsTrigger value="paste" className="flex-1 text-xs gap-1.5 data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400">
                <ClipboardPaste className="w-3.5 h-3.5" />Paste
              </TabsTrigger>
            </TabsList>

            <TabsContent value="feed" className="flex flex-col flex-1 mt-0 min-h-0">
              <div className="px-4 py-3 border-b border-gray-800 shrink-0">
                <p className="text-xs text-gray-500">
                  {sourceArticles.length === 0 ? "No articles selected." : `${sourceArticles.length} article${sourceArticles.length > 1 ? "s" : ""} selected`}
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-3 py-3 space-y-2">
                  {sourceArticles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-700 p-4 text-center">
                      <p className="text-xs text-gray-500">Go to <Link href="/admin/feed" className="text-emerald-400 hover:underline">Feed Reader</Link> and select 1–5 articles.</p>
                    </div>
                  )}
                  {sourceArticles.map((a) => (
                    <div key={a.id} className="rounded-md bg-gray-800 border border-gray-700 p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-white font-medium line-clamp-2 leading-snug">{a.title}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-gray-500">{a.sourceName}</span>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-emerald-400"><ExternalLink className="w-3 h-3" /></a>
                          </div>
                        </div>
                        <button onClick={() => removeSource(a.id)} className="flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <SettingsPanel mode="feed" />
            </TabsContent>

            <TabsContent value="paste" className="flex flex-col flex-1 mt-0 min-h-0">
              <div className="px-4 py-3 border-b border-gray-800 shrink-0">
                <p className="text-xs text-gray-500">Paste text from any source — AI rewrites into one article.</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-3 py-3 space-y-3">
                  {pasteBlocks.map((block, i) => (
                    <div key={block.id} className="rounded-md bg-gray-800 border border-gray-700 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Source {i + 1}</span>
                        {pasteBlocks.length > 1 && (
                          <button onClick={() => removePasteBlock(block.id)} className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                      <Input
                        type="text"
                        value={block.label}
                        onChange={(e) => updatePasteBlock(block.id, "label", e.target.value)}
                        placeholder="Source name (optional)"
                        className="w-full h-7 px-2 py-1 bg-gray-900 border-gray-700 text-xs text-white placeholder-gray-600 focus-visible:ring-emerald-500"
                      />
                      <Textarea
                        value={block.text}
                        onChange={(e) => updatePasteBlock(block.id, "text", e.target.value)}
                        rows={5}
                        placeholder="Paste article text here…"
                        className="w-full bg-gray-900 border-gray-700 text-xs text-gray-200 placeholder-gray-600 focus-visible:ring-emerald-500 resize-y leading-relaxed font-mono"
                      />
                    </div>
                  ))}
                  {pasteBlocks.length < 5 && (
                    <button onClick={addPasteBlock}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-dashed border-gray-700 text-xs text-gray-500 hover:border-emerald-700 hover:text-emerald-400 transition-colors">
                      <Plus className="w-3.5 h-3.5" />Add another source ({pasteBlocks.length}/5)
                    </button>
                  )}
                </div>
              </ScrollArea>
              <SettingsPanel mode="paste" />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right panel: editor + metadata */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Header: metadata + publish buttons */}
          <div className="px-6 py-4 border-b border-gray-800 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Article Editor</h2>
                {/* Draft saved indicator */}
                {draftSavedAt && (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Save className="w-3 h-3" />
                    Draft saved {Math.round((Date.now() - draftSavedAt) / 1000)}s ago
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Clear draft */}
                {(content || title) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={clearDraft} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />Clear
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Clear draft</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Publish EN only */}
                <button onClick={handlePublish} disabled={publishing || publishingBoth || !content}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-xs font-medium text-white transition-colors">
                  {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {publishing ? "Publishing…" : "Publish EN"}
                </button>
                {/* Publish both EN+ZH */}
                <button onClick={handlePublishBoth} disabled={publishing || publishingBoth || !content}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white transition-colors">
                  {publishingBoth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
                  {publishingBoth ? "Translating & Publishing…" : "Publish EN + ZH"}
                </button>
              </div>
            </div>

            {/* Metadata fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="article-title" className="text-xs text-gray-500">Title</Label>
                <Input
                  id="article-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-gray-800 border-gray-700 text-sm text-white placeholder-gray-500 focus-visible:ring-emerald-500"
                  placeholder="Article title…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="article-slug" className="text-xs text-gray-500">Slug</Label>
                <Input
                  id="article-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full bg-gray-800 border-gray-700 text-xs text-white placeholder-gray-500 focus-visible:ring-emerald-500 font-mono"
                  placeholder="article-slug"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-sm text-white h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="text-sm text-white capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Article type</Label>
                <div className="flex gap-2">
                  {(["posts", "threat-intel"] as const).map((t) => (
                    <button key={t} onClick={() => setArticleType(t)}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${articleType === t ? "bg-emerald-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      {t === "posts" ? "Article" : "Threat Intel"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="article-tags" className="text-xs text-gray-500">Tags (comma separated)</Label>
                <Input
                  id="article-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-gray-800 border-gray-700 text-sm text-white placeholder-gray-500 focus-visible:ring-emerald-500"
                  placeholder="ransomware, CVE-2024-1234"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="article-excerpt" className="text-xs text-gray-500">Excerpt</Label>
                <Textarea
                  id="article-excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  rows={2}
                  className="w-full bg-gray-800 border-gray-700 text-sm text-white placeholder-gray-500 focus-visible:ring-emerald-500 resize-none"
                  placeholder="Short description for cards and SEO…"
                />
              </div>
            </div>
          </div>

          <Separator className="bg-gray-800" />

          {/* Content editor / preview */}
          <div className="flex-1 px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Label className="text-xs text-gray-500 font-medium uppercase tracking-wider">Content</Label>
                {wordCount > 0 && <span className="text-xs text-gray-600">~{wordCount} words</span>}
              </div>
              {/* Edit / Preview toggle */}
              <div className="flex rounded-md overflow-hidden border border-gray-700">
                <button onClick={() => setPreviewMode("edit")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${previewMode === "edit" ? "bg-gray-700 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-300"}`}>
                  <Code2 className="w-3.5 h-3.5" />Edit
                </button>
                <button onClick={() => setPreviewMode("preview")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${previewMode === "preview" ? "bg-gray-700 text-white" : "bg-gray-900 text-gray-500 hover:text-gray-300"}`}>
                  <Eye className="w-3.5 h-3.5" />Preview
                </button>
              </div>
            </div>

            {previewMode === "edit" ? (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-[calc(100vh-560px)] min-h-64 bg-gray-900 border-gray-800 text-sm text-gray-200 placeholder-gray-600 focus-visible:ring-emerald-500 font-mono resize-none leading-relaxed"
                placeholder="Generated article content will appear here. You can also write or paste markdown directly…"
              />
            ) : (
              <div className="w-full h-[calc(100vh-560px)] min-h-64 overflow-y-auto rounded-lg bg-gray-900 border border-gray-800 px-6 py-4">
                {content ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-gray-600 text-sm font-mono">{"// Nothing to preview yet"}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
