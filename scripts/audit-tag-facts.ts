import fs from "fs";
import path from "path";

interface Sheet {
  tag: string;
  locale: string;
  top_actors: string[];
  top_cves: { id: string; cvss?: number }[];
  top_sectors: string[];
  top_regions: string[];
}

// Descriptor patterns — strings that are adjectives/descriptions, not proper nouns
const DESCRIPTOR_PATTERNS: Array<{ field: string; rx: RegExp }> = [
  {
    field: "actor",
    rx: /^(unknown|unnamed|undisclosed|anonymous|russian-speaking|chinese-speaking|north korean|iranian|state-sponsored|state sponsored|nation-state|nation state|apt group|threat actor|threat group|cybercrime group|ransomware gang|affiliate|affiliates)s?(\s|$)|\b(threat actor|threat group|actors?)$/i,
  },
  {
    field: "actor",
    rx: /^(a |an |the )/i, // articles at start = descriptor
  },
  {
    field: "sector",
    rx: /^(any |all |various |multiple |any sector using |various sectors)/i,
  },
  {
    field: "region",
    rx: /^(various|multiple|global scale|worldwide scale)/i,
  },
];

const CVE_RX = /^CVE-\d{4}-\d{4,}$/;

function loadAllSheets(): Sheet[] {
  const base = path.join(process.cwd(), "data", "tag-facts");
  const out: Sheet[] = [];
  for (const loc of ["en", "zh"]) {
    const dir = path.join(base, loc);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    }
  }
  return out;
}

function auditActors(sheets: Sheet[]) {
  const hits: { tag: string; locale: string; value: string }[] = [];
  for (const s of sheets) {
    for (const a of s.top_actors ?? []) {
      for (const p of DESCRIPTOR_PATTERNS.filter((x) => x.field === "actor")) {
        if (p.rx.test(a)) {
          hits.push({ tag: s.tag, locale: s.locale, value: a });
          break;
        }
      }
    }
  }
  return hits;
}

function auditSectors(sheets: Sheet[]) {
  const hits: { tag: string; locale: string; value: string }[] = [];
  for (const s of sheets) {
    for (const v of s.top_sectors ?? []) {
      for (const p of DESCRIPTOR_PATTERNS.filter((x) => x.field === "sector")) {
        if (p.rx.test(v)) {
          hits.push({ tag: s.tag, locale: s.locale, value: v });
          break;
        }
      }
    }
  }
  return hits;
}

function auditRegions(sheets: Sheet[]) {
  const hits: { tag: string; locale: string; value: string }[] = [];
  for (const s of sheets) {
    for (const v of s.top_regions ?? []) {
      for (const p of DESCRIPTOR_PATTERNS.filter((x) => x.field === "region")) {
        if (p.rx.test(v)) {
          hits.push({ tag: s.tag, locale: s.locale, value: v });
          break;
        }
      }
    }
    // Also flag case-collisions: "Global" vs "global"
    const lowered = (s.top_regions ?? []).map((r) => r.toLowerCase());
    if (new Set(lowered).size < (s.top_regions ?? []).length) {
      hits.push({
        tag: s.tag,
        locale: s.locale,
        value: `case-dupe: ${s.top_regions.join("|")}`,
      });
    }
  }
  return hits;
}

function auditCves(sheets: Sheet[]) {
  const hits: { tag: string; locale: string; value: string }[] = [];
  for (const s of sheets) {
    for (const c of s.top_cves ?? []) {
      if (!CVE_RX.test(c.id))
        hits.push({ tag: s.tag, locale: s.locale, value: c.id });
    }
  }
  return hits;
}

function unique(hits: { tag: string; locale: string; value: string }[]) {
  return Array.from(new Set(hits.map((h) => h.value))).sort();
}

function main() {
  const sheets = loadAllSheets();
  console.log(
    `loaded ${sheets.length} sheets (${sheets.filter((s) => s.locale === "en").length} en + ${sheets.filter((s) => s.locale === "zh").length} zh)`,
  );
  console.log();

  const actorHits = auditActors(sheets);
  console.log(
    `── top_actors: ${actorHits.length} hits across ${new Set(actorHits.map((h) => h.tag)).size} tags`,
  );
  console.log("  unique values:", unique(actorHits).join(" | "));
  console.log();

  const sectorHits = auditSectors(sheets);
  console.log(
    `── top_sectors: ${sectorHits.length} hits across ${new Set(sectorHits.map((h) => h.tag)).size} tags`,
  );
  console.log("  unique values:", unique(sectorHits).join(" | "));
  console.log();

  const regionHits = auditRegions(sheets);
  console.log(
    `── top_regions: ${regionHits.length} hits across ${new Set(regionHits.map((h) => h.tag)).size} tags`,
  );
  console.log("  unique values:", unique(regionHits).join(" | "));
  console.log();

  const cveHits = auditCves(sheets);
  console.log(`── top_cves (malformed IDs): ${cveHits.length}`);
  if (cveHits.length) console.log("  values:", unique(cveHits).join(" | "));
}

main();
