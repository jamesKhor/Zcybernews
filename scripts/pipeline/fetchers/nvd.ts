/**
 * NVD Recent-CVE JSON feed parser.
 *
 * Phase B post-audit (2026-04-22). NVD is the NIST-authoritative source
 * for CVE identifiers + CVSS scores + CPE configurations. Publishing
 * against NVD-sourced stories means the `vulnerabilities` category's
 * CVE hard-gate is satisfied upstream by a primary source rather than
 * inferred from second-hand reports.
 *
 * Feed URL: https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json
 * Window: the "recent" file is maintained by NIST to cover CVEs
 *         published or modified in the last 8 days.
 *
 * Module split:
 *   - `mapNvdToStories(data)`   PURE — NVD JSON → Story[]. Tested in isolation.
 *   - `fetchNvd(source)`        IO — wraps fetch + timeout + the pure mapper.
 *
 * This keeps the complexity of NVD's shape out of the network path, and
 * the network path out of the tests.
 */
import type { FeedSource } from "../../sources/feeds.js";
import type { Story } from "../../utils/dedup.js";

const NVD_WALL_CLOCK_MS = 25_000;
const MAX_STORIES_PER_FETCH = 20;

// ─── NVD 2.0 shape (narrow projection — only fields we consume) ───────
// Full schema: https://nvd.nist.gov/developers/vulnerabilities

interface NvdDescription {
  lang: string;
  value: string;
}
interface NvdCvssData {
  baseScore?: number;
  vectorString?: string;
  baseSeverity?: string;
}
interface NvdMetric {
  cvssData?: NvdCvssData;
  source?: string;
}
interface NvdMetrics {
  cvssMetricV31?: NvdMetric[];
  cvssMetricV30?: NvdMetric[];
  cvssMetricV2?: NvdMetric[];
}
interface NvdReference {
  url: string;
  source?: string;
  tags?: string[];
}
interface NvdCve {
  id: string;
  published?: string;
  lastModified?: string;
  descriptions?: NvdDescription[];
  metrics?: NvdMetrics;
  references?: NvdReference[];
  weaknesses?: Array<{ description?: NvdDescription[] }>;
}
interface NvdVulnerability {
  cve: NvdCve;
}
export interface NvdFeedPayload {
  vulnerabilities?: NvdVulnerability[];
  format?: string;
  version?: string;
  timestamp?: string;
}

// ─── Pure mapper ──────────────────────────────────────────────────────

/**
 * Map a parsed NVD JSON payload to Story records.
 *
 * Design choices:
 *   - Skip CVEs without an English description (we can't reason about
 *     the text otherwise — ZH description backfill is a Stage 4d job).
 *   - Pick the highest CVSS score across v3.1 / v3.0 / v2 metrics.
 *   - Use the first high-quality reference as `url`; fall back to the
 *     NVD detail page if no references exist.
 *   - Set `sourceCategory = "vulnerabilities"` regardless of the
 *     FeedSource.category (NVD IS the vulns source of truth; other
 *     tagging would be confusing downstream).
 *   - `isVendor: false` — NVD is not a vendor PR pipeline.
 *
 * @param data  Parsed JSON from NVD recent feed
 * @param source Configured feed source (for id / name / qualityScore)
 * @param now ISO timestamp to stamp as `fetchedAt`; injected so tests
 *            don't need to freeze the clock.
 */
export function mapNvdToStories(
  data: NvdFeedPayload,
  source: FeedSource,
  now: string,
): Story[] {
  const vulns = data.vulnerabilities ?? [];
  const out: Story[] = [];

  for (const entry of vulns) {
    const cve = entry.cve;
    if (!cve?.id) continue;

    // English description only — ZH-native NVD isn't a thing.
    const enDesc = cve.descriptions?.find((d) => d.lang === "en")?.value;
    if (!enDesc || enDesc.trim().length < 40) continue;

    // Highest CVSS score across supported metric versions.
    const scores: number[] = [];
    const collect = (list?: NvdMetric[]) => {
      for (const m of list ?? []) {
        if (typeof m.cvssData?.baseScore === "number") {
          scores.push(m.cvssData.baseScore);
        }
      }
    };
    collect(cve.metrics?.cvssMetricV31);
    collect(cve.metrics?.cvssMetricV30);
    collect(cve.metrics?.cvssMetricV2);
    const highestScore = scores.length > 0 ? Math.max(...scores) : null;

    // First reference URL, else NVD detail page
    const primaryRef = cve.references?.find((r) => r.url)?.url;
    const url = primaryRef ?? `https://nvd.nist.gov/vuln/detail/${cve.id}`;

    // Tags — include CVE ID + any CWE IDs from weaknesses
    const cweTags: string[] = [];
    for (const w of cve.weaknesses ?? []) {
      for (const d of w.description ?? []) {
        if (d.lang === "en" && d.value.startsWith("CWE-")) {
          cweTags.push(d.value);
        }
      }
    }

    // Title includes CVE ID for human dedup; body excerpt carries the
    // NVD description + score so the LLM has the primary-source text.
    const scorePart = highestScore !== null ? ` (CVSS ${highestScore})` : "";
    const title = `${cve.id}${scorePart}: ${enDesc.slice(0, 140).trim()}`.slice(
      0,
      200,
    );
    const excerpt = enDesc.slice(0, 400);

    const publishedAt = cve.published ?? cve.lastModified ?? now;

    out.push({
      id: `nvd-${cve.id}`,
      title,
      url,
      excerpt,
      sourceName: source.name,
      publishedAt: new Date(publishedAt).toISOString(),
      tags: [cve.id, "NVD", ...cweTags].slice(0, 5),
      // A2.2 additive fields
      sourceId: source.id,
      // NVD is authoritative for vulnerabilities; override whatever
      // the source config says.
      sourceCategory: "vulnerabilities",
      fetchedAt: now,
      qualityScore: source.qualityScore ?? 1.0,
      isVendor: false,
    });
  }

  // Sort newest-published first, cap to avoid one feed dominating
  out.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  return out.slice(0, MAX_STORIES_PER_FETCH);
}

// ─── IO wrapper ───────────────────────────────────────────────────────

/**
 * Fetch NVD recent feed + map. Called by ingest-rss.ts when
 * source.type === "nvd-json".
 */
export async function fetchNvd(source: FeedSource): Promise<Story[]> {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "ZCyberNews/1.0 Pipeline (+https://zcybernews.com)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(NVD_WALL_CLOCK_MS),
  });
  if (!res.ok) {
    throw new Error(`NVD HTTP ${res.status}`);
  }
  const data = (await res.json()) as NvdFeedPayload;
  const now = new Date().toISOString();
  return mapNvdToStories(data, source, now);
}
