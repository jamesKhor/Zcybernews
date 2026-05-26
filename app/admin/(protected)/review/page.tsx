"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import {
  AlertCircle,
  CheckCircle2,
  CirclePause,
  ExternalLink,
  Loader2,
  Newspaper,
  Save,
  Search,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  NegativeTasteSignal,
  PositiveTasteSignal,
  ReviewQueueCandidate,
  ReviewStatus,
} from "@/scripts/pipeline/review-queue";

type RunSummary = {
  runKey: string;
  runId: string;
  generatedAt: string;
  candidateCount: number;
  statusCounts: Record<ReviewStatus, number>;
};

type LoadedCandidate = {
  path: string;
  candidate: ReviewQueueCandidate;
};

type LoadedRun = {
  runKey: string;
  manifest: {
    runId: string;
    generatedAt: string;
    candidateCount: number;
  };
  candidates: LoadedCandidate[];
  statusCounts: Record<ReviewStatus, number>;
};

type ApiResponse = {
  runs: RunSummary[];
  activeRun: LoadedRun | null;
  options: {
    statuses: Array<Exclude<ReviewStatus, "pending">>;
    positiveSignals: PositiveTasteSignal[];
    negativeSignals: NegativeTasteSignal[];
  };
};

type ReviewForm = {
  status: Exclude<ReviewStatus, "pending">;
  reviewedBy: string;
  tasteRating: string;
  decisionReason: string;
  tasteReason: string;
  positiveSignals: PositiveTasteSignal[];
  negativeSignals: NegativeTasteSignal[];
  selectedReasonTags: string;
  siteFitNotes: string;
  readerFitNotes: string;
  operatorNotes: string;
  calibrationRound: string;
};

const STATUS_CONFIG: Record<
  Exclude<ReviewStatus, "pending">,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  approved: {
    label: "Approve",
    icon: CheckCircle2,
    className: "border-emerald-700 bg-emerald-950 text-emerald-300",
  },
  hold: {
    label: "Hold",
    icon: CirclePause,
    className: "border-yellow-700 bg-yellow-950 text-yellow-300",
  },
  "digest-only": {
    label: "Digest",
    icon: Newspaper,
    className: "border-blue-700 bg-blue-950 text-blue-300",
  },
  reject: {
    label: "Reject",
    icon: XCircle,
    className: "border-red-700 bg-red-950 text-red-300",
  },
};

function emptyForm(): ReviewForm {
  return {
    status: "approved",
    reviewedBy: "alex",
    tasteRating: "0.80",
    decisionReason: "",
    tasteReason: "",
    positiveSignals: [],
    negativeSignals: [],
    selectedReasonTags: "",
    siteFitNotes: "",
    readerFitNotes: "",
    operatorNotes: "",
    calibrationRound: "",
  };
}

function formFromCandidate(candidate: ReviewQueueCandidate): ReviewForm {
  const reviewer = candidate.reviewer;
  return {
    status: reviewer.status === "pending" ? "approved" : reviewer.status,
    reviewedBy: reviewer.reviewedBy ?? "alex",
    tasteRating:
      typeof reviewer.tasteRating === "number"
        ? reviewer.tasteRating.toFixed(2)
        : "0.80",
    decisionReason: reviewer.decisionReason ?? "",
    tasteReason: reviewer.tasteReason ?? "",
    positiveSignals: reviewer.positiveSignals ?? [],
    negativeSignals: reviewer.negativeSignals ?? [],
    selectedReasonTags: (reviewer.selectedReasonTags ?? []).join(", "),
    siteFitNotes: reviewer.siteFitNotes ?? "",
    readerFitNotes: reviewer.readerFitNotes ?? "",
    operatorNotes: reviewer.operatorNotes ?? "",
    calibrationRound: reviewer.calibrationRound ?? "",
  };
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function statusPill(status: ReviewStatus) {
  if (status === "pending") {
    return "border-gray-700 bg-gray-800 text-gray-300";
  }
  return STATUS_CONFIG[status].className;
}

function scoreClass(score: number) {
  if (score >= 0.75) return "text-emerald-300";
  if (score >= 0.55) return "text-yellow-300";
  return "text-gray-400";
}

export default function AdminReviewQueuePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<LoadedRun | null>(null);
  const [positiveOptions, setPositiveOptions] = useState<PositiveTasteSignal[]>(
    [],
  );
  const [negativeOptions, setNegativeOptions] = useState<NegativeTasteSignal[]>(
    [],
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [form, setForm] = useState<ReviewForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () =>
      activeRun?.candidates.find((item) => item.path === selectedPath) ??
      activeRun?.candidates[0] ??
      null,
    [activeRun, selectedPath],
  );

  const loadQueue = useCallback(async (runKey?: string) => {
    setLoading(true);
    try {
      const url = runKey
        ? `/api/admin/review-queue?run=${encodeURIComponent(runKey)}`
        : "/api/admin/review-queue";
      const res = await adminFetch(url);
      const data = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load queue");
      setRuns(data.runs);
      setActiveRun(data.activeRun);
      setPositiveOptions(data.options.positiveSignals);
      setNegativeOptions(data.options.negativeSignals);
      const firstPath = data.activeRun?.candidates[0]?.path ?? null;
      setSelectedPath((current) => current ?? firstPath);
      if (data.activeRun?.candidates[0]) {
        setForm(formFromCandidate(data.activeRun.candidates[0].candidate));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selected) setForm(formFromCandidate(selected.candidate));
  }, [selected]);

  const filteredCandidates = useMemo(() => {
    const candidates = activeRun?.candidates ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(({ candidate }) =>
      [
        candidate.proposedTitle,
        candidate.lane,
        candidate.clusterKey,
        candidate.seoBrief.primaryQueryTarget,
        ...candidate.selectionReasons,
        ...candidate.sourceNames,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [activeRun, query]);

  async function saveReview() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidatePath: selected.path,
          status: form.status,
          reviewedBy: form.reviewedBy,
          tasteRating: Number(form.tasteRating),
          decisionReason: form.decisionReason,
          tasteReason: form.tasteReason,
          positiveSignals: form.positiveSignals,
          negativeSignals: form.negativeSignals,
          selectedReasonTags: splitTags(form.selectedReasonTags),
          siteFitNotes: form.siteFitNotes,
          readerFitNotes: form.readerFitNotes,
          operatorNotes: form.operatorNotes,
          calibrationRound: form.calibrationRound,
        }),
      });
      const data = (await res.json()) as {
        candidate?: ReviewQueueCandidate;
        error?: string;
      };
      if (!res.ok || !data.candidate) {
        throw new Error(data.error ?? "Failed to save review");
      }
      setActiveRun((current) => {
        if (!current) return current;
        const candidates = current.candidates.map((item) =>
          item.path === selected.path
            ? { ...item, candidate: data.candidate! }
            : item,
        );
        return { ...current, candidates };
      });
      toast.success("Review saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">Review Queue</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {activeRun
              ? `${activeRun.manifest.candidateCount} candidates in ${activeRun.runKey}`
              : "No editorial queue runs found"}
          </p>
        </div>

        <select
          value={activeRun?.runKey ?? ""}
          onChange={(event) => {
            setSelectedPath(null);
            loadQueue(event.target.value);
          }}
          className="h-9 min-w-56 rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-gray-200"
        >
          {runs.length === 0 && <option value="">No queue runs</option>}
          {runs.map((run) => (
            <option key={run.runKey} value={run.runKey}>
              {run.runKey} ({run.candidateCount})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-80 items-center justify-center text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading queue
        </div>
      ) : !activeRun ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-400">
          No review queue exists yet. Run the pipeline in curate-only mode
          first.
        </div>
      ) : (
        <div className="grid h-[calc(100vh-128px)] grid-cols-[360px_1fr] gap-5">
          <section className="flex min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 p-3">
              <div className="mb-3 grid grid-cols-5 gap-1 text-center text-[11px]">
                {(
                  [
                    "pending",
                    "approved",
                    "hold",
                    "digest-only",
                    "reject",
                  ] as ReviewStatus[]
                ).map((status) => (
                  <div
                    key={status}
                    className={`rounded border px-1.5 py-1 ${statusPill(status)}`}
                  >
                    {activeRun.statusCounts[status] ?? 0}
                  </div>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search queue"
                  className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
              {filteredCandidates.map((item) => {
                const candidate = item.candidate;
                const isSelected = selected?.path === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => setSelectedPath(item.path)}
                    className={`mb-2 w-full rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-emerald-700 bg-emerald-950/30"
                        : "border-gray-800 bg-gray-950 hover:border-gray-700"
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium text-gray-100">
                        {candidate.proposedTitle}
                      </p>
                      <span
                        className={`text-sm font-semibold ${scoreClass(candidate.score)}`}
                      >
                        {candidate.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300">
                        {candidate.lane}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] ${statusPill(candidate.reviewer.status)}`}
                      >
                        {candidate.reviewer.status}
                      </span>
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400">
                        {candidate.sourceCount} sources
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-h-0 overflow-auto rounded-lg border border-gray-800 bg-gray-900">
            {selected ? (
              <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-0">
                <div className="min-w-0 border-r border-gray-800 p-5">
                  <div className="mb-5">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
                        {selected.candidate.lane}
                      </span>
                      <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
                        {selected.candidate.decision}
                      </span>
                      <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
                        {selected.candidate.clusterKey}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold leading-tight text-white">
                      {selected.candidate.proposedTitle}
                    </h2>
                  </div>

                  <div className="mb-5 grid grid-cols-6 gap-2">
                    {Object.entries(selected.candidate.scoreBreakdown).map(
                      ([key, value]) => (
                        <div
                          key={key}
                          className="rounded-md border border-gray-800 bg-gray-950 p-2"
                        >
                          <p className="text-[11px] capitalize text-gray-500">
                            {key}
                          </p>
                          <p className="text-sm font-semibold text-gray-100">
                            {value.toFixed(2)}
                          </p>
                        </div>
                      ),
                    )}
                  </div>

                  <DetailBlock title="Selection Reasons">
                    <div className="flex flex-wrap gap-1.5">
                      {selected.candidate.selectionReasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-300"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </DetailBlock>

                  <DetailBlock title="SEO Brief">
                    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
                      <dt className="text-gray-500">Query</dt>
                      <dd className="text-gray-200">
                        {selected.candidate.seoBrief.primaryQueryTarget}
                      </dd>
                      <dt className="text-gray-500">Intent</dt>
                      <dd className="text-gray-200">
                        {selected.candidate.seoBrief.searchIntent}
                      </dd>
                      <dt className="text-gray-500">Hub</dt>
                      <dd className="text-gray-200">
                        {selected.candidate.seoBrief.targetHub ?? "none"}
                      </dd>
                      <dt className="text-gray-500">Title Promise</dt>
                      <dd className="text-gray-200">
                        {selected.candidate.seoBrief.titlePromise}
                      </dd>
                    </dl>
                  </DetailBlock>

                  <DetailBlock title="Sources">
                    <div className="space-y-2">
                      {selected.candidate.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-md border border-gray-800 bg-gray-950 p-3 hover:border-gray-700"
                        >
                          <div className="mb-1 flex items-start justify-between gap-3">
                            <p className="line-clamp-2 text-sm font-medium text-gray-100">
                              {source.title}
                            </p>
                            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                          </div>
                          <p className="text-xs text-gray-500">
                            {source.sourceName ?? "source"}{" "}
                            {source.publishedAt
                              ? `- ${new Date(source.publishedAt).toLocaleString()}`
                              : ""}
                          </p>
                          {source.excerpt && (
                            <p className="mt-2 line-clamp-2 text-xs text-gray-400">
                              {source.excerpt}
                            </p>
                          )}
                        </a>
                      ))}
                    </div>
                  </DetailBlock>
                </div>

                <aside className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Review Decision
                    </h3>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2">
                    {(
                      Object.keys(STATUS_CONFIG) as Array<
                        Exclude<ReviewStatus, "pending">
                      >
                    ).map((status) => {
                      const Icon = STATUS_CONFIG[status].icon;
                      const active = form.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              status,
                            }))
                          }
                          className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                            active
                              ? STATUS_CONFIG[status].className
                              : "border-gray-700 bg-gray-950 text-gray-400 hover:text-white"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {STATUS_CONFIG[status].label}
                        </button>
                      );
                    })}
                  </div>

                  <Field label="Reviewer">
                    <input
                      value={form.reviewedBy}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          reviewedBy: event.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100"
                    />
                  </Field>

                  <Field label={`Taste Rating ${form.tasteRating}`}>
                    <input
                      type="range"
                      min="0.01"
                      max="1"
                      step="0.01"
                      value={form.tasteRating}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          tasteRating: event.target.value,
                        }))
                      }
                      className="w-full accent-emerald-500"
                    />
                  </Field>

                  <Field label="Decision Reason">
                    <textarea
                      value={form.decisionReason}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          decisionReason: event.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                    />
                  </Field>

                  <SignalGroup
                    label="Positive Signals"
                    options={positiveOptions}
                    selected={form.positiveSignals}
                    onToggle={(value) =>
                      setForm((current) => ({
                        ...current,
                        positiveSignals: toggleValue(
                          current.positiveSignals,
                          value,
                        ),
                      }))
                    }
                  />

                  <SignalGroup
                    label="Negative Signals"
                    options={negativeOptions}
                    selected={form.negativeSignals}
                    onToggle={(value) =>
                      setForm((current) => ({
                        ...current,
                        negativeSignals: toggleValue(
                          current.negativeSignals,
                          value,
                        ),
                      }))
                    }
                  />

                  <Field label="Reason Tags">
                    <input
                      value={form.selectedReasonTags}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          selectedReasonTags: event.target.value,
                        }))
                      }
                      placeholder="hot-topic, ransomware"
                      className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                    />
                  </Field>

                  <Field label="Taste Reason">
                    <textarea
                      value={form.tasteReason}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          tasteReason: event.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                    />
                  </Field>

                  <Field label="Site Fit">
                    <textarea
                      value={form.siteFitNotes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          siteFitNotes: event.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                    />
                  </Field>

                  <Field label="Reader Fit">
                    <textarea
                      value={form.readerFitNotes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          readerFitNotes: event.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                    />
                  </Field>

                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <Field label="Operator Notes">
                      <textarea
                        value={form.operatorNotes}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            operatorNotes: event.target.value,
                          }))
                        }
                        rows={2}
                        className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100"
                      />
                    </Field>
                    <Field label="Round">
                      <input
                        value={form.calibrationRound}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            calibrationRound: event.target.value,
                          }))
                        }
                        placeholder="day-3"
                        className="h-9 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                      />
                    </Field>
                  </div>

                  <button
                    type="button"
                    onClick={saveReview}
                    disabled={saving || !form.decisionReason.trim()}
                    className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Review
                  </button>

                  {!form.decisionReason.trim() && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-yellow-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Decision reason is required.
                    </p>
                  )}
                </aside>
              </div>
            ) : (
              <div className="p-8 text-sm text-gray-400">
                Select a candidate to review.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-medium text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function SignalGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                checked
                  ? "border-emerald-700 bg-emerald-950 text-emerald-300"
                  : "border-gray-700 bg-gray-950 text-gray-400 hover:text-white"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
