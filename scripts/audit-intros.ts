/**
 * Post-bulk audit: re-run fact-check on every written intro against its
 * sheet. Catches any slip-through that the inline generator missed (stale
 * cache, partial writes, etc).
 */
import fs from "fs";
import path from "path";
import { checkTagIntro } from "./tag-intros/fact-check.js";
import { isSparse } from "./tag-intros/sparse-template.js";
import type { TagFactSheet, TagIntroRecord } from "./tag-intros/types.js";

const CVE_RX = /CVE-\d{4}-\d{4,}/gi;

function loadSheet(tag: string, locale: "en" | "zh"): TagFactSheet | null {
  const file = path.join(
    process.cwd(),
    "data",
    "tag-facts",
    locale,
    `${tag}.json`,
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function auditLocale(locale: "en" | "zh") {
  const dir = path.join(process.cwd(), "data", "tag-intros", locale);
  if (!fs.existsSync(dir)) {
    console.log(`[${locale}] no intros found`);
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const problems: { tag: string; issue: string }[] = [];
  let templateCount = 0,
    llmCount = 0;
  for (const f of files) {
    const tag = f.replace(/\.json$/, "");
    const record: TagIntroRecord = JSON.parse(
      fs.readFileSync(path.join(dir, f), "utf-8"),
    );
    const sheet = loadSheet(tag, locale) ?? loadSheet(tag, "en");
    if (!sheet) {
      problems.push({ tag, issue: "no matching fact sheet (orphan)" });
      continue;
    }
    if (record.model === "template:sparse") {
      templateCount++;
      // Templates are deterministic — skip fact-check but sanity check length.
      if (record.intro.length < 50)
        problems.push({
          tag,
          issue: `template too short (${record.intro.length} chars)`,
        });
      continue;
    }
    llmCount++;

    // Fact-check: CVE IDs in intro must appear in sheet
    const introCves = Array.from(
      new Set((record.intro.match(CVE_RX) ?? []).map((s) => s.toUpperCase())),
    );
    const sheetCves = new Set(sheet.top_cves.map((c) => c.id.toUpperCase()));
    for (const cve of introCves) {
      if (!sheetCves.has(cve))
        problems.push({ tag, issue: `CVE ${cve} not in sheet` });
    }

    // Actors: any word in intro that starts with upper + contains letters — check against actor list
    // This is lossy, so just check the explicit top_actors strings are findable if mentioned
    for (const actor of sheet.top_actors ?? []) {
      // skip check — we rely on LLM preserving spelling, and we don't want to force every actor to appear
    }

    // Banned phrase scan
    const banned = [
      "stay tuned",
      "read more",
      "emerging threat",
      "unprecedented",
      "sophisticated attack",
    ];
    for (const phrase of banned) {
      if (record.intro.toLowerCase().includes(phrase))
        problems.push({ tag, issue: `banned phrase: "${phrase}"` });
    }

    // Re-run the full fact-check module for defense-in-depth
    const check = checkTagIntro(record.intro, sheet, { locale });
    if (!check.passed) {
      for (const iss of check.issues) {
        problems.push({ tag, issue: `fact-check ${iss.type}: ${iss.message}` });
      }
    }
  }

  console.log(
    `[${locale}] ${files.length} intros (${llmCount} llm + ${templateCount} template) — ${problems.length} issues`,
  );
  for (const p of problems) console.log(`  ❌ ${p.tag}: ${p.issue}`);
}

auditLocale("en");
auditLocale("zh");
