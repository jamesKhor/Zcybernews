#!/usr/bin/env tsx
/**
 * One-shot sync script — read career YAMLs from the sibling zcyber-xhs
 * project and emit validated JSON snapshots into this repo's data/
 * directory.
 *
 * Run manually when zcyber-xhs updates its topic banks:
 *
 *   npx tsx scripts/sync-career-data.ts
 *
 * Why this lives here, not in zcyber-xhs:
 * - Per portfolio rule (~/.claude/CLAUDE.md): no cross-repo edits in a
 *   single session. zcybernews is the consumer; it pulls from its
 *   sibling repo on disk and commits the JSON itself.
 * - CI never reaches across repos — the JSON is committed source.
 *
 * Failure modes:
 * - YAML missing (sibling repo not on disk): exits 1 with friendly hint
 * - Schema drift: Zod prints exact field that changed
 * - Empty result: exits 1 (don't ship a blank dataset)
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  SalaryRecordSchema,
  CertRecordSchema,
  type SalaryRecord,
  type CertRecord,
} from "../lib/salary.js";

const XHS_REPO = path.resolve(process.cwd(), "..", "zcyber-xhs");
const SOURCE = {
  salary: path.join(XHS_REPO, "config", "topic_banks", "salary_map.yaml"),
  cert: path.join(XHS_REPO, "config", "topic_banks", "cert_war.yaml"),
};
const TARGET = {
  salary: path.join(process.cwd(), "data", "salary-data.json"),
  cert: path.join(process.cwd(), "data", "cert-data.json"),
};

type YamlBank<T> = { topics: T[] };

function readYaml<T>(filePath: string, label: string): T[] {
  if (!fs.existsSync(filePath)) {
    console.error(
      `\n❌ Source file not found: ${filePath}\n` +
        `   Expected the zcyber-xhs sibling repo at: ${XHS_REPO}\n` +
        `   Either clone it next to zcybernews, or skip this sync.\n`,
    );
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as YamlBank<T>;
  if (!parsed || !Array.isArray(parsed.topics)) {
    console.error(`❌ ${label}: YAML missing 'topics:' array`);
    process.exit(1);
  }
  return parsed.topics;
}

function validateAll<T>(
  records: T[],
  schema: {
    safeParse: (input: T) => {
      success: boolean;
      error?: { issues: unknown[] };
      data?: unknown;
    };
  },
  label: string,
): unknown[] {
  const valid: unknown[] = [];
  const errors: { idx: number; issues: unknown[] }[] = [];
  records.forEach((rec, idx) => {
    const result = schema.safeParse(rec);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.error) {
      errors.push({ idx, issues: result.error.issues });
    }
  });
  if (errors.length > 0) {
    console.error(
      `\n⚠️ ${label}: ${errors.length} of ${records.length} records failed validation:\n`,
    );
    errors.slice(0, 5).forEach((e) => {
      console.error(`  record #${e.idx}:`);
      console.error(
        `    ${JSON.stringify(e.issues, null, 2).split("\n").join("\n    ")}`,
      );
    });
    if (errors.length > 5) console.error(`  …and ${errors.length - 5} more`);
  }
  return valid;
}

function writeJson(filePath: string, data: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Pretty-printed JSON — diffs are readable, files are committed
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Merge manually-curated fields from the EXISTING JSON snapshot into the
 * fresh sync result, keyed by `slug`.
 *
 * WHY: some fields (e.g. `top_tier_salary`, `top_tier_note`) are added
 * directly in this repo by the operator/another session, not in the
 * source YAML. Without this merge a sync would clobber them.
 *
 * Rule: any key present in the existing record AND absent from the
 * fresh record gets carried over. Keys present in BOTH always take the
 * fresh value (source-of-truth wins for shared fields).
 */
function mergePreservedFields<T extends { slug?: string }>(
  fresh: T[],
  existingPath: string,
): T[] {
  if (!fs.existsSync(existingPath)) return fresh;
  let existing: T[];
  try {
    existing = JSON.parse(fs.readFileSync(existingPath, "utf-8")) as T[];
  } catch {
    console.warn(
      `[sync] ⚠️  Could not parse existing ${path.basename(existingPath)} — skipping merge`,
    );
    return fresh;
  }
  const existingBySlug = new Map<string, T>();
  for (const r of existing) {
    if (r.slug) existingBySlug.set(r.slug, r);
  }
  let preservedCount = 0;
  const merged = fresh.map((freshRec) => {
    if (!freshRec.slug) return freshRec;
    const prev = existingBySlug.get(freshRec.slug);
    if (!prev) return freshRec;
    const out: Record<string, unknown> = { ...freshRec };
    for (const [k, v] of Object.entries(prev)) {
      if (!(k in (freshRec as Record<string, unknown>)) && v !== undefined) {
        out[k] = v;
        preservedCount++;
      }
    }
    return out as T;
  });
  if (preservedCount > 0) {
    console.log(
      `[sync] ↳ preserved ${preservedCount} manual annotation field(s) from existing ${path.basename(existingPath)}`,
    );
  }
  return merged;
}

function main(): void {
  console.log("[sync] Reading from:", XHS_REPO);

  // Salary
  const salaryRaw = readYaml<SalaryRecord>(SOURCE.salary, "salary_map.yaml");
  console.log(`[sync] salary_map.yaml: ${salaryRaw.length} records`);
  const salary = validateAll(salaryRaw, SalaryRecordSchema, "salary_map");
  if (salary.length === 0) {
    console.error(
      "❌ Zero valid salary records — refusing to write empty dataset",
    );
    process.exit(1);
  }
  const salaryMerged = mergePreservedFields(
    salary as { slug?: string }[],
    TARGET.salary,
  );
  writeJson(TARGET.salary, salaryMerged);
  console.log(
    `[sync] ✓ Wrote ${salaryMerged.length} salary records → ${path.relative(process.cwd(), TARGET.salary)}`,
  );

  // Cert
  const certRaw = readYaml<CertRecord>(SOURCE.cert, "cert_war.yaml");
  console.log(`[sync] cert_war.yaml: ${certRaw.length} records`);
  const cert = validateAll(certRaw, CertRecordSchema, "cert_war");
  if (cert.length === 0) {
    console.error(
      "❌ Zero valid cert records — refusing to write empty dataset",
    );
    process.exit(1);
  }
  const certMerged = mergePreservedFields(
    cert as { slug?: string }[],
    TARGET.cert,
  );
  writeJson(TARGET.cert, certMerged);
  console.log(
    `[sync] ✓ Wrote ${certMerged.length} cert records → ${path.relative(process.cwd(), TARGET.cert)}`,
  );

  console.log("\n[sync] Done. Review with: git diff data/");
}

main();
