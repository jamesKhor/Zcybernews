import fs from "fs";
import path from "path";

export type FeedSource = {
  id: string;
  name: string;
  url: string;
  category: string;
  // Widened 2026-04-22 to accept `nvd-json` (placeholder for the NVD
  // recent-CVE feed; parser not yet built — source is enabled:false).
  // Widening to `string` is intentional: the pipeline branches on
  // well-known values ("cisa-kev" etc.) and treats unknowns as RSS.
  // Switching to a strict union later is cheap once all types are
  // plumbed end-to-end.
  type: string;
  enabled: boolean;
  description?: string;
  // Additive fields (Phase B A2.2, 2026-04-22). Populated from
  // data/rss-sources.json when present; `qualityScore` defaults to
  // 1.0 at fetch time when absent.
  qualityScore?: number;
};

// Single source of truth: data/rss-sources.json
// Both the admin panel and the pipeline read from this file.
const SOURCES_PATH = path.join(process.cwd(), "data", "rss-sources.json");

function loadSources(): FeedSource[] {
  const raw = fs.readFileSync(SOURCES_PATH, "utf-8");
  return JSON.parse(raw);
}

export const FEED_SOURCES: FeedSource[] = loadSources();

export const ENABLED_SOURCES = FEED_SOURCES.filter((s) => s.enabled);
