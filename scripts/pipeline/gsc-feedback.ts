#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface GscRow {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  indexingStatus?: string;
}

export interface GscDemandHints {
  generatedAt: string;
  sourceFile?: string;
  entities: Record<string, number>;
  patterns: Record<string, number>;
  summary: {
    rowCount: number;
    queryRows: number;
    pageRows: number;
    importedQueries: number;
    nonIndexedRows: number;
  };
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

export function parseGscCsv(input: string): Record<string, string>[] {
  const rows = csvRows(input);
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index]?.trim() ?? ""]),
      ),
    );
}

function pick(
  record: Record<string, string>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (value && value.trim()) return value.trim();
  }
  const normalized = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCtr(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseNumber(value);
  if (value.includes("%") || parsed > 1) return parsed / 100;
  return parsed;
}

export function readGscRows(records: Record<string, string>[]): GscRow[] {
  return records.map((record) => ({
    query: pick(record, ["Query", "Top queries", "Search query"]),
    page: pick(record, ["Page", "Pages", "Top pages", "URL"]),
    clicks: parseNumber(pick(record, ["Clicks"])),
    impressions: parseNumber(pick(record, ["Impressions"])),
    ctr: parseCtr(pick(record, ["CTR", "Click-through rate"])),
    position: parseNumber(pick(record, ["Position", "Average position"])),
    indexingStatus: pick(record, ["Indexing status", "Status", "Coverage"]),
  }));
}

function normalizeQuery(query: string): string | null {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^"|"$/g, "");

  if (normalized.length < 3 || normalized.length > 80) return null;
  if (normalized.includes("site:") || normalized.includes("zcybernews")) {
    return null;
  }
  if (/^https?:\/\//.test(normalized) || normalized.includes("www.")) {
    return null;
  }

  return normalized;
}

function queryWeight(row: GscRow): number {
  const impressionBoost = Math.min(
    0.25,
    Math.log10(row.impressions + 1) * 0.08,
  );
  const clickBoost = Math.min(0.16, row.clicks * 0.005);
  const positionBoost =
    row.position > 0 && row.position <= 3
      ? 0.15
      : row.position <= 10
        ? 0.1
        : row.position <= 20
          ? 0.05
          : 0;
  const ctrBoost = row.ctr >= 0.05 ? 0.1 : row.ctr >= 0.02 ? 0.05 : 0;
  const score = 0.45 + impressionBoost + clickBoost + positionBoost + ctrBoost;
  return Math.max(0.05, Math.min(0.95, Math.round(score * 100) / 100));
}

export function buildGscDemandHints(
  rows: GscRow[],
  options: { generatedAt?: string; sourceFile?: string } = {},
): GscDemandHints {
  const entities: Record<string, number> = {};
  let importedQueries = 0;

  for (const row of rows) {
    if (!row.query) continue;
    const query = normalizeQuery(row.query);
    if (!query) continue;
    entities[query] = Math.max(entities[query] ?? 0, queryWeight(row));
    importedQueries += 1;
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceFile: options.sourceFile,
    entities,
    patterns: {},
    summary: {
      rowCount: rows.length,
      queryRows: rows.filter((row) => row.query).length,
      pageRows: rows.filter((row) => row.page).length,
      importedQueries,
      nonIndexedRows: rows.filter((row) =>
        /not indexed|excluded|duplicate|crawled|discovered/i.test(
          row.indexingStatus ?? "",
        ),
      ).length,
    },
  };
}

function parseArgs(argv: string[]): { input?: string; out?: string } {
  const args: { input?: string; out?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
  }
  return args;
}

export function runGscFeedbackImport(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  if (!args.input) {
    console.error(
      "Usage: npx tsx scripts/pipeline/gsc-feedback.ts --input=<search-console.csv> [--out=data/gsc-demand-hints.json]",
    );
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(
    args.out ?? path.join(process.cwd(), "data", "gsc-demand-hints.json"),
  );
  const rows = readGscRows(parseGscCsv(fs.readFileSync(inputPath, "utf-8")));
  const hints = buildGscDemandHints(rows, {
    sourceFile: path.relative(process.cwd(), inputPath),
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(hints, null, 2)}\n`, "utf-8");
  console.log(
    `[gsc-feedback] rows=${hints.summary.rowCount} importedQueries=${hints.summary.importedQueries} out=${path.relative(process.cwd(), outPath)}`,
  );
}

const isCli = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCli) runGscFeedbackImport();
