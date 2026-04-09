import Parser from "rss-parser";
import sourcesData from "@/data/rss-sources.json";

export type RssSource = {
  id: string;
  name: string;
  url: string;
  category: string;
  type: "rss" | "cisa-kev";
  enabled: boolean;
  description: string;
};

export type FeedArticle = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceCategory: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string;
  author?: string;
  tags?: string[];
  severity?: "critical" | "high" | "medium" | "low";
};

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "AleCyberNews/1.0 RSS Reader",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

export function getSources(): RssSource[] {
  return sourcesData as RssSource[];
}

export function getEnabledSources(): RssSource[] {
  return getSources().filter((s) => s.enabled);
}

async function fetchRssFeed(source: RssSource): Promise<FeedArticle[]> {
  try {
    const feed = await parser.parseURL(source.url);
    return (feed.items ?? []).slice(0, 30).map((item, i) => ({
      id: `${source.id}-${item.guid ?? item.link ?? i}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      title: item.title ?? "Untitled",
      url: item.link ?? "",
      excerpt: stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 280),
      publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
      author: item.creator ?? item.author,
      tags: item.categories ?? [],
    }));
  } catch (err) {
    console.error(`[rss] Failed to fetch ${source.name}:`, err);
    return [];
  }
}

type CisaKevEntry = {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
};

async function fetchCisaKev(source: RssSource): Promise<FeedArticle[]> {
  try {
    const res = await fetch(source.url, {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "AleCyberNews/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { vulnerabilities: CisaKevEntry[] };
    const vulns = (data.vulnerabilities ?? []).slice(0, 30);

    return vulns.map((v) => ({
      id: `cisa-kev-${v.cveID}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceCategory: source.category,
      title: `[${v.cveID}] ${v.vulnerabilityName}`,
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
      excerpt: `${v.shortDescription} Required action: ${v.requiredAction} Due: ${v.dueDate}`,
      publishedAt: new Date(v.dateAdded).toISOString(),
      tags: [v.vendorProject, v.product, "KEV", "CISA"],
      severity: "critical",
    }));
  } catch (err) {
    console.error(`[cisa-kev] Failed to fetch:`, err);
    return [];
  }
}

export async function fetchAllFeeds(sourceIds?: string[]): Promise<FeedArticle[]> {
  const sources = getEnabledSources().filter(
    (s) => !sourceIds || sourceIds.includes(s.id)
  );

  const results = await Promise.allSettled(
    sources.map((s) => (s.type === "cisa-kev" ? fetchCisaKev(s) : fetchRssFeed(s)))
  );

  const articles: FeedArticle[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") articles.push(...result.value);
  }

  // Sort by date descending
  return articles.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
