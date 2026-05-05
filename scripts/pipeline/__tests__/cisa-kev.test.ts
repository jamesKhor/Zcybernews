import { describe, expect, it } from "vitest";
import { mapCisaKevToStories, type CisaKevEntry } from "../ingest-rss";
import { deduplicate, storyIdentityKey } from "../../utils/dedup";
import type { FeedSource } from "../../sources/feeds";

const SOURCE: FeedSource = {
  id: "cisa-kev",
  name: "CISA Known Exploited Vulnerabilities",
  url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
  category: "vulnerabilities",
  type: "cisa-kev",
  enabled: true,
  qualityScore: 1,
};

const NOW = "2026-05-05T00:00:00.000Z";

const entries: CisaKevEntry[] = [
  {
    cveID: "CVE-2026-1111",
    vulnerabilityName: "Example One",
    shortDescription:
      "Example One is actively exploited and affects Example Gateway.",
    requiredAction: "Apply vendor mitigations.",
    dateAdded: "2026-05-01",
    dueDate: "2026-05-21",
    vendorProject: "Example",
    product: "Gateway",
  },
  {
    cveID: "CVE-2026-2222",
    vulnerabilityName: "Example Two",
    shortDescription:
      "Example Two is actively exploited and affects Example Console.",
    requiredAction: "Apply vendor updates.",
    dateAdded: "2026-05-02",
    dueDate: "2026-05-22",
    vendorProject: "Example",
    product: "Console",
  },
];

describe("mapCisaKevToStories", () => {
  it("assigns each KEV row a unique processed identity while preserving the source URL", () => {
    const stories = mapCisaKevToStories(entries, SOURCE, NOW);

    expect(stories).toHaveLength(2);
    expect(stories.map((s) => s.url)).toEqual([
      "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
      "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    ]);
    expect(stories.map(storyIdentityKey)).toEqual([
      "cisa-kev-CVE-2026-1111",
      "cisa-kev-CVE-2026-2222",
    ]);
  });

  it("does not deduplicate distinct KEV CVEs just because they share the catalog URL", () => {
    const stories = mapCisaKevToStories(entries, SOURCE, NOW);

    expect(deduplicate(stories)).toHaveLength(2);
  });
});
