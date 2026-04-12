import Parser from "rss-parser";
import { ENABLED_SOURCES, type FeedSource } from "../sources/feeds.js";
import { deduplicate, type Story } from "../utils/dedup.js";
import { isProcessed } from "../utils/cache.js";
import { limit, withRetry } from "../utils/rate-limit.js";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "ZCyberNews/1.0 Pipeline (+https://zcybernews.com)",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRss(source: FeedSource): Promise<Story[]> {
  const feed = await parser.parseURL(source.url);
  return (feed.items ?? []).slice(0, 25).map((item, i) => ({
    id: `${source.id}-${item.guid ?? item.link ?? i}`,
    title: item.title ?? "Untitled",
    url: item.link ?? "",
    excerpt: stripHtml(
      item.contentSnippet ?? item.content ?? item.summary ?? "",
    ).slice(0, 400),
    sourceName: source.name,
    publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
    tags: (item.categories ?? []).slice(0, 5),
  }));
}

type CisaKevEntry = {
  cveID: string;
  vulnerabilityName: string;
  shortDescription: string;
  requiredAction: string;
  dateAdded: string;
  dueDate: string;
  vendorProject: string;
  product: string;
};

async function fetchCisaKev(source: FeedSource): Promise<Story[]> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": "ZCyberNews/1.0 Pipeline" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
  const data = (await res.json()) as { vulnerabilities: CisaKevEntry[] };
  return (data.vulnerabilities ?? []).slice(0, 20).map((v) => ({
    id: `cisa-kev-${v.cveID}`,
    title: `[${v.cveID}] ${v.vulnerabilityName}`,
    url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    excerpt: `${v.shortDescription} Required action: ${v.requiredAction} Due: ${v.dueDate}`,
    sourceName: source.name,
    publishedAt: new Date(v.dateAdded).toISOString(),
    tags: [v.vendorProject, v.product, "KEV", "CISA"].filter(Boolean),
  }));
}

/** Fetch all enabled feeds, deduplicate, filter already-processed URLs. */
export async function ingestFeeds(maxStories = 20): Promise<Story[]> {
  console.log(`[ingest] Fetching ${ENABLED_SOURCES.length} RSS sources…`);

  const results = await Promise.allSettled(
    ENABLED_SOURCES.map((source) =>
      limit(() =>
        withRetry(() =>
          source.type === "cisa-kev" ? fetchCisaKev(source) : fetchRss(source),
        ),
      ),
    ),
  );

  const all: Story[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    } else {
      console.warn(
        `[ingest] Failed ${ENABLED_SOURCES[i]?.name}:`,
        result.reason,
      );
    }
  }

  console.log(`[ingest] Fetched ${all.length} raw stories`);

  // Sort by date descending
  all.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  // Dedup by title similarity + URL
  const deduped = deduplicate(all);
  console.log(`[ingest] After dedup: ${deduped.length} stories`);

  // Filter already processed
  const fresh = deduped.filter((s) => s.url && !isProcessed(s.url));
  console.log(`[ingest] Fresh (not yet processed): ${fresh.length} stories`);

  return fresh.slice(0, maxStories);
}
