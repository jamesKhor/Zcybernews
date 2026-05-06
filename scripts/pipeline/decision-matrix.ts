import fs from "node:fs";
import path from "node:path";

export type DecisionOutcome = "published" | "not_published";
export type GateOutcome = "pass" | "warn" | "block" | "skip" | "fail";

export interface DecisionGate {
  gate: string;
  outcome: GateOutcome;
  detail?: string;
}

export interface DecisionMatrixEntry {
  index: number;
  outcome: DecisionOutcome;
  sourceTitle: string;
  sourceName?: string;
  sourceUrl?: string;
  articleTitle?: string;
  slug?: string;
  category?: string;
  severity?: string | null;
  stage: string;
  decision: string;
  reasons: string[];
  gates: DecisionGate[];
  sourceCount?: number;
  locale?: string;
}

export interface DecisionMatrixSummary {
  total: number;
  published: number;
  notPublished: number;
  byStage: Record<string, number>;
  byReason: Record<string, number>;
}

export interface DecisionMatrixFile {
  generatedAt: string;
  summary: DecisionMatrixSummary;
  entries: DecisionMatrixEntry[];
}

const DEFAULT_OUTPUT_DIR = ".pipeline-cache";
const DEFAULT_JSON_FILE = "decision-matrix.json";
const DEFAULT_TELEGRAM_FILE = "decision-matrix.telegram.txt";
const BOLD_OPEN = "__ZCN_BOLD_OPEN__";
const BOLD_CLOSE = "__ZCN_BOLD_CLOSE__";

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export function summarizeDecisionMatrix(
  entries: DecisionMatrixEntry[],
): DecisionMatrixSummary {
  const summary: DecisionMatrixSummary = {
    total: entries.length,
    published: entries.filter((entry) => entry.outcome === "published").length,
    notPublished: entries.filter((entry) => entry.outcome === "not_published")
      .length,
    byStage: {},
    byReason: {},
  };

  for (const entry of entries) {
    inc(summary.byStage, entry.stage);
    if (entry.reasons.length === 0) {
      inc(summary.byReason, entry.decision);
    } else {
      for (const reason of entry.reasons) inc(summary.byReason, reason);
    }
  }

  return summary;
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(value: string, max = 92): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function formatGateSummary(entry: DecisionMatrixEntry): string {
  const blocked = entry.gates.find(
    (gate) => gate.outcome === "block" || gate.outcome === "fail",
  );
  if (blocked) {
    return `${blocked.gate}: ${blocked.detail ?? entry.reasons.join(", ")}`;
  }

  const compact = entry.gates
    .filter((gate) => gate.outcome !== "skip")
    .map((gate) => {
      if (gate.detail) return `${gate.gate} ${gate.outcome} (${gate.detail})`;
      return `${gate.gate} ${gate.outcome}`;
    })
    .slice(0, 7)
    .join("; ");

  return compact || entry.decision;
}

function formatEntry(entry: DecisionMatrixEntry): string {
  const title = entry.articleTitle || entry.sourceTitle;
  const source = entry.sourceName ? ` [${entry.sourceName}]` : "";
  const severity = entry.severity ? ` sev=${entry.severity}` : "";
  const category = entry.category ? ` cat=${entry.category}` : "";
  const gateSummary = formatGateSummary(entry);
  return `- ${truncate(title)}${source}${category}${severity}\n  ${entry.decision}: ${gateSummary}`;
}

function topReasons(summary: DecisionMatrixSummary, limit = 5): string {
  const reasons = Object.entries(summary.byReason)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([reason, count]) => `${reason} (${count})`);

  return reasons.length > 0 ? reasons.join(", ") : "none";
}

export function formatDecisionMatrixForTelegram(
  entries: DecisionMatrixEntry[],
  options: { publishedLimit?: number; skippedLimit?: number } = {},
): string {
  const { publishedLimit = 3, skippedLimit = 6 } = options;
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const summary = summarizeDecisionMatrix(sorted);
  const published = sorted
    .filter((entry) => entry.outcome === "published")
    .slice(0, publishedLimit);
  const skipped = sorted
    .filter((entry) => entry.outcome === "not_published")
    .slice(0, skippedLimit);

  const lines = [
    `${BOLD_OPEN}Decision gates${BOLD_CLOSE}`,
    `Published: ${summary.published} | Not published: ${summary.notPublished}`,
    `Top reasons: ${topReasons(summary)}`,
  ];

  if (published.length > 0) {
    lines.push("", `${BOLD_OPEN}Why published${BOLD_CLOSE}`);
    for (const entry of published) lines.push(formatEntry(entry));
    const remaining = summary.published - published.length;
    if (remaining > 0) lines.push(`- ...and ${remaining} more published`);
  }

  if (skipped.length > 0) {
    lines.push("", `${BOLD_OPEN}Why not published${BOLD_CLOSE}`);
    for (const entry of skipped) lines.push(formatEntry(entry));
    const remaining = summary.notPublished - skipped.length;
    if (remaining > 0) lines.push(`- ...and ${remaining} more not published`);
  }

  return escapeTelegramHtml(lines.join("\n"))
    .replaceAll(BOLD_OPEN, "<b>")
    .replaceAll(BOLD_CLOSE, "</b>");
}

export function writeDecisionMatrix(
  entries: DecisionMatrixEntry[],
  options: {
    outputDir?: string;
    jsonFile?: string;
    telegramFile?: string;
  } = {},
): DecisionMatrixFile {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const jsonFile = options.jsonFile ?? DEFAULT_JSON_FILE;
  const telegramFile = options.telegramFile ?? DEFAULT_TELEGRAM_FILE;
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const payload: DecisionMatrixFile = {
    generatedAt: new Date().toISOString(),
    summary: summarizeDecisionMatrix(sorted),
    entries: sorted,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, jsonFile),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, telegramFile),
    `${formatDecisionMatrixForTelegram(sorted)}\n`,
  );

  return payload;
}
