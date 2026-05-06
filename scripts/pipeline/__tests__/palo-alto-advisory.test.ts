import { describe, expect, it } from "vitest";
import { mapPaloAltoAdvisoryItemsToStories } from "../ingest-rss";
import type { FeedSource } from "../../sources/feeds";

const source: FeedSource = {
  id: "palo-alto-advisories",
  name: "Palo Alto Networks Security Advisories",
  url: "https://security.paloaltonetworks.com/rss.xml",
  category: "vulnerabilities",
  type: "palo-alto-advisory-rss",
  enabled: true,
  sourceLanguage: "en",
  seoIntent: "rank-both",
};

describe("mapPaloAltoAdvisoryItemsToStories", () => {
  it("builds a useful excerpt from Palo Alto RSS titles with blank descriptions", () => {
    const stories = mapPaloAltoAdvisoryItemsToStories(
      [
        {
          title:
            "CVE-2026-0300 PAN-OS: Unauthenticated user initiated Buffer Overflow Vulnerability in User-ID Authentication Portal (Severity: CRITICAL)",
          link: "https://security.paloaltonetworks.com/CVE-2026-0300",
          pubDate: "2026-05-05T23:00:00.000Z",
          guid: "https://security.paloaltonetworks.com/CVE-2026-0300",
        },
      ],
      source,
      "2026-05-06T00:00:00.000Z",
    );

    expect(stories).toHaveLength(1);
    expect(stories[0].excerpt).toContain("CVE-2026-0300");
    expect(stories[0].excerpt).toContain("critical severity");
    expect(stories[0].excerpt).toContain("PAN-OS");
    expect(stories[0].tags).toContain("CRITICAL");
    expect(stories[0].tags).toContain("CVE-2026-0300");
    expect(stories[0].isVendor).toBe(true);
  });
});
