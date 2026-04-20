/**
 * P4 — Translate EN tag intros → ZH via Kimi (Kimi-first per operator preference).
 *
 * Fact-check guard: all CVE IDs and actor names in the EN intro must survive
 * translation byte-identical (they must NOT be localized). Retry ×2 on failure.
 *
 * Usage:
 *   npx tsx scripts/tag-intros/translate-intros.ts --limit 3
 *   npx tsx scripts/tag-intros/translate-intros.ts
 *   npx tsx scripts/tag-intros/translate-intros.ts --force
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.join(process.cwd(), ".env.local") });
import { translateWithFallback } from "../../lib/ai-provider.js";
import {
  buildTagIntroTranslatePrompt,
  TAG_INTRO_PROMPT_VERSION,
} from "../ai/prompts/tag-intro.js";
import { checkTagIntro, formatCheckLog } from "./fact-check.js";
import { isSparse, buildSparseIntroZh } from "./sparse-template.js";
import type { TagFactSheet, TagIntroRecord } from "./types.js";

const MAX_RETRIES = 2;
const REJECTED_LOG = path.join(
  process.cwd(),
  "data",
  "tag-intros",
  "_rejected.json",
);
const CVE_REGEX = /CVE-\d{4}-\d{4,}/gi;

interface Args {
  limit?: number;
  force?: boolean;
  tag?: string;
  provider?: "deepseek" | "kimi" | "auto";
}
function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = parseInt(argv[++i], 10);
    else if (a === "--force") out.force = true;
    else if (a === "--tag") out.tag = argv[++i];
    else if (a === "--provider") out.provider = argv[++i] as Args["provider"];
  }
  return out;
}

function sanitize(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sha(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function loadEnIntro(tag: string): TagIntroRecord | null {
  const file = path.join(
    process.cwd(),
    "data",
    "tag-intros",
    "en",
    sanitize(tag) + ".json",
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as TagIntroRecord;
}

function loadZhIntro(tag: string): TagIntroRecord | null {
  const file = path.join(
    process.cwd(),
    "data",
    "tag-intros",
    "zh",
    sanitize(tag) + ".json",
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as TagIntroRecord;
  } catch {
    return null;
  }
}

function loadFactSheet(tag: string, locale: "en" | "zh"): TagFactSheet | null {
  const file = path.join(
    process.cwd(),
    "data",
    "tag-facts",
    locale,
    sanitize(tag) + ".json",
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as TagFactSheet;
}

function writeRecord(record: TagIntroRecord): string {
  const dir = path.join(process.cwd(), "data", "tag-intros", record.locale);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sanitize(record.tag) + ".json");
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", "utf-8");
  return file;
}

function appendRejected(entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(REJECTED_LOG), { recursive: true });
  const current: unknown[] = fs.existsSync(REJECTED_LOG)
    ? JSON.parse(fs.readFileSync(REJECTED_LOG, "utf-8"))
    : [];
  current.push({ ...entry, at: new Date().toISOString() });
  fs.writeFileSync(
    REJECTED_LOG,
    JSON.stringify(current, null, 2) + "\n",
    "utf-8",
  );
}

/** Ensure every CVE ID and actor name in EN survives verbatim in ZH. */
function verifyPreservation(
  enText: string,
  zhText: string,
  sheet: TagFactSheet,
): string[] {
  const missing: string[] = [];
  const enCves = Array.from(
    new Set((enText.match(CVE_REGEX) ?? []).map((s) => s.toUpperCase())),
  );
  for (const cve of enCves) {
    if (!zhText.toUpperCase().includes(cve)) missing.push(cve);
  }
  for (const actor of sheet.top_actors) {
    if (enText.includes(actor) && !zhText.includes(actor)) missing.push(actor);
  }
  return missing;
}

export async function translateOne(
  enRecord: TagIntroRecord,
  opts: { force?: boolean; provider?: "deepseek" | "kimi" | "auto" } = {},
): Promise<{
  status: "written" | "skipped" | "rejected";
  record?: TagIntroRecord;
}> {
  const sheet = loadFactSheet(enRecord.tag, "en");
  if (!sheet) {
    console.warn(`[translate] ${enRecord.tag}: EN fact sheet missing — skip`);
    return { status: "rejected" };
  }

  const sourceIntroHash = sha(enRecord.intro);
  const existingZh = loadZhIntro(enRecord.tag);
  if (
    !opts.force &&
    existingZh &&
    existingZh.source_intro_hash === sourceIntroHash &&
    existingZh.sources_hash === enRecord.sources_hash
  ) {
    console.log(`[translate] ${enRecord.tag}: up-to-date — skip`);
    return { status: "skipped", record: existingZh };
  }

  // Sparse short-circuit — if the ZH fact sheet is also sparse, emit the
  // deterministic ZH template directly. Saves API cost and avoids the
  // risk of the translator propagating hallucinated tokens that somehow
  // made it past EN fact-check.
  const zhSheet = loadFactSheet(enRecord.tag, "zh") ?? sheet;
  if (isSparse(zhSheet)) {
    const intro = buildSparseIntroZh(zhSheet);
    const record: TagIntroRecord = {
      tag: enRecord.tag,
      locale: "zh",
      intro,
      sources_hash: enRecord.sources_hash,
      source_intro_hash: sourceIntroHash,
      model: "template:sparse",
      generated_at: new Date().toISOString(),
      prompt_version: TAG_INTRO_PROMPT_VERSION,
    };
    const file = writeRecord(record);
    console.log(
      `[translate] ${enRecord.tag}: ✅ template (${intro.length} chars) → ${file}`,
    );
    return { status: "written", record };
  }

  const prompt = buildTagIntroTranslatePrompt(enRecord.intro, sheet);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const effectivePrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nStrictly preserve every CVE ID and threat actor name byte-for-byte.`;
    try {
      const result = await translateWithFallback(effectivePrompt, {
        provider: opts.provider ?? "kimi",
        maxOutputTokens: 800,
        temperature: 0.3,
      });
      const zh = result.text.trim();

      // Guard 1: CVE/actor preservation
      const missing = verifyPreservation(enRecord.intro, zh, sheet);
      if (missing.length > 0) {
        lastError = `missing preserved tokens: ${missing.join(", ")}`;
        console.warn(
          `[translate] ${enRecord.tag} attempt ${attempt}: ${lastError}`,
        );
        continue;
      }

      // Guard 2: word-count sanity (CJK band)
      const check = checkTagIntro(zh, sheet, { locale: "zh" });
      if (!check.passed) {
        lastError = check.issues.map((i) => i.message).join("; ");
        console.warn(
          `[translate] ${enRecord.tag} attempt ${attempt}: ${formatCheckLog(check)}`,
        );
        continue;
      }

      const record: TagIntroRecord = {
        tag: enRecord.tag,
        locale: "zh",
        intro: zh,
        sources_hash: enRecord.sources_hash,
        source_intro_hash: sourceIntroHash,
        model: result.modelUsed,
        generated_at: new Date().toISOString(),
        prompt_version: TAG_INTRO_PROMPT_VERSION,
      };
      const file = writeRecord(record);
      console.log(
        `[translate] ${enRecord.tag}: ✅ ${check.wordCount} chars → ${file}`,
      );
      return { status: "written", record };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[translate] ${enRecord.tag} attempt ${attempt} threw: ${lastError.slice(0, 200)}`,
      );
    }
  }

  appendRejected({ tag: enRecord.tag, locale: "zh", lastError });
  console.error(`[translate] ${enRecord.tag}: REJECTED — ${lastError}`);
  return { status: "rejected" };
}

function loadAllEnIntros(): TagIntroRecord[] {
  const dir = path.join(process.cwd(), "data", "tag-intros", "en");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map(
      (f) =>
        JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as TagIntroRecord,
    );
}

async function main() {
  const args = parseArgs();
  let intros = loadAllEnIntros();
  if (args.tag) intros = intros.filter((r) => r.tag === args.tag);
  if (typeof args.limit === "number") intros = intros.slice(0, args.limit);

  if (intros.length === 0) {
    console.log(
      "[translate] no EN intros found — run generate-intros.ts first",
    );
    return;
  }

  let written = 0,
    skipped = 0,
    rejected = 0;
  for (const rec of intros) {
    const res = await translateOne(rec, {
      force: args.force,
      provider: args.provider,
    });
    if (res.status === "written") written++;
    else if (res.status === "skipped") skipped++;
    else rejected++;
  }
  console.log(
    `[translate] done — ${written} written, ${skipped} skipped, ${rejected} rejected`,
  );
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("translate-intros.ts") ||
    process.argv[1].endsWith("translate-intros.js"));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
