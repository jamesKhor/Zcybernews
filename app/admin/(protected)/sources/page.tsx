"use client";

import { useEffect, useState, useCallback } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import {
  Rss,
  CheckCircle,
  XCircle,
  ExternalLink,
  Plus,
  Trash2,
  TestTube,
  Loader2,
  X,
  Power,
} from "lucide-react";

type RssSource = {
  id: string;
  name: string;
  url: string;
  category: string;
  type: "rss" | "cisa-kev";
  enabled: boolean;
  description: string;
};

const categoryColors: Record<string, string> = {
  cybersecurity: "bg-red-950 text-red-400 border-red-800/40",
  tech: "bg-orange-950 text-orange-400 border-orange-800/40",
  vulnerabilities: "bg-purple-950 text-purple-400 border-purple-800/40",
};

const CATEGORIES = ["cybersecurity", "tech", "vulnerabilities"] as const;

export default function SourcesPage() {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    title?: string;
    itemCount?: number;
    error?: string;
  } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    const res = await adminFetch("/api/admin/sources");
    if (res.ok) setSources(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/sources")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) {
          setSources(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(source: RssSource) {
    setTogglingId(source.id);
    const res = await adminFetch("/api/admin/sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, enabled: !source.enabled }),
    });
    if (res.ok) {
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id ? { ...s, enabled: !s.enabled } : s,
        ),
      );
    }
    setTogglingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this source?")) return;
    setDeletingId(id);
    const res = await adminFetch(`/api/admin/sources?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== id));
    }
    setDeletingId(null);
  }

  async function handleTest(source: RssSource) {
    setTestingId(source.id);
    setTestResult(null);
    try {
      const res = await adminFetch("/api/admin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", url: source.url }),
      });
      const data = await res.json();
      setTestResult({ id: source.id, ...data });
    } catch {
      setTestResult({ id: source.id, ok: false, error: "Network error" });
    }
    setTestingId(null);
  }

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">RSS Sources</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {enabledCount} of {sources.length} sources active
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Source
        </button>
      </div>

      {/* Add source modal */}
      {showAdd && (
        <AddSourceModal
          onClose={() => setShowAdd(false)}
          onAdded={(s) => {
            setSources((prev) => [...prev, s]);
            setShowAdd(false);
          }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className={`rounded-lg bg-gray-900 border p-4 transition-colors ${
                source.enabled
                  ? "border-gray-800"
                  : "border-gray-800/50 opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 flex-shrink-0">
                    {source.enabled ? (
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-gray-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white">
                        {source.name}
                      </p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          categoryColors[source.category] ??
                          "bg-gray-800 text-gray-400 border-gray-700"
                        }`}
                      >
                        {source.category}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-500 border-gray-700 uppercase">
                        {source.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {source.description}
                    </p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-400 mt-1.5 transition-colors"
                    >
                      <Rss className="w-3 h-3" />
                      {source.url.length > 60
                        ? source.url.slice(0, 60) + "…"
                        : source.url}
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    {/* Test result */}
                    {testResult?.id === source.id && (
                      <div
                        className={`mt-2 text-xs rounded px-2 py-1 ${
                          testResult.ok
                            ? "bg-emerald-950/50 text-emerald-400"
                            : "bg-red-950/50 text-red-400"
                        }`}
                      >
                        {testResult.ok
                          ? `Feed OK — "${testResult.title}" (${testResult.itemCount} items)`
                          : `Error: ${testResult.error}`}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Test button */}
                  <button
                    onClick={() => handleTest(source)}
                    disabled={testingId === source.id}
                    className="p-1.5 rounded-md text-gray-500 hover:text-blue-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    title="Test feed"
                  >
                    {testingId === source.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                  </button>

                  {/* Toggle button */}
                  <button
                    onClick={() => handleToggle(source)}
                    disabled={togglingId === source.id}
                    className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                      source.enabled
                        ? "text-emerald-400 hover:text-yellow-400 hover:bg-gray-800"
                        : "text-gray-600 hover:text-emerald-400 hover:bg-gray-800"
                    }`}
                    title={source.enabled ? "Disable" : "Enable"}
                  >
                    <Power className="w-4 h-4" />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(source.id)}
                    disabled={deletingId === source.id}
                    className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    title="Remove source"
                  >
                    {deletingId === source.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Add Source Modal ────────────────────────────────────────────────────────

function AddSourceModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (source: RssSource) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    url: "",
    category: "cybersecurity" as string,
    type: "rss" as "rss" | "cisa-kev",
    description: "",
  });
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const id = form.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  async function handleTest() {
    setTesting(true);
    setTestOk(null);
    try {
      const res = await adminFetch("/api/admin/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", url: form.url }),
      });
      const data = await res.json();
      setTestOk(data.ok);
      if (data.ok && !form.name && data.title) {
        setForm((f) => ({ ...f, name: data.title }));
      }
    } catch {
      setTestOk(false);
    }
    setTesting(false);
  }

  async function handleSave() {
    if (!form.name || !form.url) {
      setError("Name and URL are required");
      return;
    }
    setSaving(true);
    setError("");
    const res = await adminFetch("/api/admin/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...form }),
    });
    if (res.ok) {
      onAdded(await res.json());
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to save");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add RSS Source</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* URL + Test */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Feed URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={form.url}
              onChange={(e) => {
                setForm((f) => ({ ...f, url: e.target.value }));
                setTestOk(null);
              }}
              placeholder="https://example.com/feed/"
              className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-600"
            />
            <button
              onClick={handleTest}
              disabled={!form.url || testing}
              className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              Test
            </button>
          </div>
          {testOk === true && (
            <p className="text-xs text-emerald-400 mt-1">Feed is valid</p>
          )}
          {testOk === false && (
            <p className="text-xs text-red-400 mt-1">
              Could not parse feed — check the URL
            </p>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Source name"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-600"
          />
          {id && <p className="text-xs text-gray-500 mt-1">ID: {id}</p>}
        </div>

        {/* Category + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Category</label>
            <select
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-600"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Type</label>
            <select
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  type: e.target.value as "rss" | "cisa-kev",
                }))
              }
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-600"
            >
              <option value="rss">RSS</option>
              <option value="cisa-kev">CISA KEV</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block">
            Description
          </label>
          <input
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="Brief description of this source"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-600"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.name || !form.url || saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Source
          </button>
        </div>
      </div>
    </div>
  );
}
