/**
 * Shared types for the tag-intro pipeline (aggregate → phrase → translate).
 */

export interface TagCve {
  id: string;
  cvss?: number;
}

export interface TagFactSheet {
  tag: string;
  locale: "en" | "zh";
  count: number;
  date_range: { first: string; latest: string };
  top_actors: string[];
  top_cves: TagCve[];
  top_sectors: string[];
  top_regions: string[];
  severity_mix: Record<string, number>;
  recent_excerpts: string[];
  sources_hash: string;
}

export interface TagIntroRecord {
  tag: string;
  locale: "en" | "zh";
  intro: string;
  sources_hash: string;
  model: string;
  generated_at: string;
  prompt_version: string;
  source_intro_hash?: string; // zh only — hash of the EN intro it was translated from
}

export const MIN_TAG_COUNT = 5;
