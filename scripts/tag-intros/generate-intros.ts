/**
 * P3 — Generate EN tag intros from fact sheets using Kimi (paid, cheap, good prose).
 *
 * Per-tag flow:
 *   1. Load data/tag-facts/en/{tag}.json
 *   2. If data/tag-intros/en/{tag}.json already exists with matching sources_hash → skip (idempotent)
 *   3. Call generateWithFallback(provider="kimi") with the prompt from scripts/ai/prompts/tag-intro.ts
 *   4. fact-check.ts validates output; retry up to 2x on failure; log rejection on 3rd
 *   5. Write data/tag-intros/en/{tag}.json
 *
 * Usage:
 *   npx tsx scripts/tag-intros/generate-intros.ts --limit 3    # dry sample
 *   npx tsx scripts/tag-intros/generate-intros.ts              # all missing tags
 *   npx tsx scripts/tag-intros/generate-intros.ts --force      # regen everything
 */
import fs from "fs";
import path from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.join(process.cwd(), ".env.local") });
import { generateWithFallback } from "../../lib/ai-provider.js";
import {
  buildTagIntroPrompt,
  TAG_INTRO_PROMPT_VERSION,
} from "../ai/prompts/tag-intro.js";
import { checkTagIntro, formatCheckLog } from "./fact-check.js";
import { isSparse, buildSparseIntroEn } from "./sparse-template.js";
import type { TagFactSheet, TagIntroRecord } from "./types.js";

const MAX_RETRIES = 2;
const REJECTED_LOG = path.join(
  process.cwd(),
  "data",
  "tag-intros",
  "_rejected.json",
);

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

function loadFactSheets(): TagFactSheet[] {
  const dir = path.join(process.cwd(), "data", "tag-facts", "en");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as TagFactSheet,
    )
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function loadExistingIntro(tag: string): TagIntroRecord | null {
  const file = path.join(
    process.cwd(),
    "data",
    "tag-intros",
    "en",
    sanitize(tag) + ".json",
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as TagIntroRecord;
  } catch {
    return null;
  }
}

function sanitize(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function writeIntroRecord(record: TagIntroRecord): string {
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

export async function generateForSheet(
  sheet: TagFactSheet,
  opts: { force?: boolean; provider?: "deepseek" | "kimi" | "auto" } = {},
): Promise<{
  status: "written" | "skipped" | "rejected";
  record?: TagIntroRecord;
}> {
  const existing = loadExistingIntro(sheet.tag);
  if (!opts.force && existing && existing.sources_hash === sheet.sources_hash) {
    console.log(
      `[generate] ${sheet.tag}: up-to-date (hash ${sheet.sources_hash}) — skip`,
    );
    return { status: "skipped", record: existing };
  }

  // Sparse sheets (density < 3) fall back to a deterministic template —
  // no LLM. Prevents the hallucination pattern caught by fact-check on
  // tags like `llm`, `soc`, `automation` where the source frontmatter
  // has no concrete actors/CVEs to ground prose in.
  if (isSparse(sheet)) {
    const intro = buildSparseIntroEn(sheet);
    const record: TagIntroRecord = {
      tag: sheet.tag,
      locale: "en",
      intro,
      sources_hash: sheet.sources_hash,
      model: "template:sparse",
      generated_at: new Date().toISOString(),
      prompt_version: TAG_INTRO_PROMPT_VERSION,
    };
    const file = writeIntroRecord(record);
    console.log(
      `[generate] ${sheet.tag}: ✅ template (${intro.split(/\s+/).length} words) → ${file}`,
    );
    return { status: "written", record };
  }

  const prompt = buildTagIntroPrompt(sheet);

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const effectivePrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nPREVIOUS ATTEMPT FAILED validation: ${lastError}\nStay strictly inside the fact sheet. Try again.`;
    try {
      const result = await generateWithFallback(effectivePrompt, {
        provider: opts.provider ?? "kimi",
        maxOutputTokens: 400,
        temperature: 0.5,
      });
      const intro = result.text.trim();
      const check = checkTagIntro(intro, sheet, { locale: "en" });
      if (check.passed) {
        const record: TagIntroRecord = {
          tag: sheet.tag,
          locale: "en",
          intro,
          sources_hash: sheet.sources_hash,
          model: result.modelUsed,
          generated_at: new Date().toISOString(),
          prompt_version: TAG_INTRO_PROMPT_VERSION,
        };
        const file = writeIntroRecord(record);
        console.log(
          `[generate] ${sheet.tag}: ${formatCheckLog(check)} → ${file}`,
        );
        return { status: "written", record };
      }
      lastError = check.issues.map((i) => i.message).join("; ");
      console.warn(
        `[generate] ${sheet.tag} attempt ${attempt}: ${formatCheckLog(check)}`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[generate] ${sheet.tag} attempt ${attempt} threw: ${lastError.slice(0, 200)}`,
      );
    }
  }

  appendRejected({ tag: sheet.tag, locale: "en", lastError });
  console.error(
    `[generate] ${sheet.tag}: REJECTED after ${MAX_RETRIES + 1} attempts — ${lastError}`,
  );
  return { status: "rejected" };
}

async function main() {
  const args = parseArgs();
  let sheets = loadFactSheets();
  if (args.tag) sheets = sheets.filter((s) => s.tag === args.tag);
  if (typeof args.limit === "number") sheets = sheets.slice(0, args.limit);

  if (sheets.length === 0) {
    console.log(
      "[generate] no fact sheets found — run aggregate-facts.ts first",
    );
    return;
  }

  let written = 0,
    skipped = 0,
    rejected = 0;
  for (const sheet of sheets) {
    const res = await generateForSheet(sheet, {
      force: args.force,
      provider: args.provider,
    });
    if (res.status === "written") written++;
    else if (res.status === "skipped") skipped++;
    else rejected++;
  }
  console.log(
    `[generate] done — ${written} written, ${skipped} skipped, ${rejected} rejected`,
  );
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("generate-intros.ts") ||
    process.argv[1].endsWith("generate-intros.js"));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
