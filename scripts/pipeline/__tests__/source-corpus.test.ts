import { describe, expect, it } from "vitest";
import {
  buildSourceCorpus,
  formatStoryForPrompt,
  storySourceText,
} from "../source-corpus";
import type { Story } from "../../utils/dedup";

const story: Story = {
  id: "s",
  title: "CVE-2026-1234 Exploited in Example Gateway",
  url: "https://example.com/advisory",
  excerpt: "RSS summary mentions CVE-2026-1234 and CVSS 9.8.",
  rawText:
    "Full fetched article text names CVE-2026-1234, CVSS 9.8, and mitigation details.",
  sourceName: "Example",
  publishedAt: "2026-05-05T00:00:00.000Z",
  tags: ["security"],
};

describe("source corpus helpers", () => {
  it("includes fetched raw text in the source corpus", () => {
    expect(storySourceText(story)).toContain("Full fetched article text");
    expect(buildSourceCorpus([story])).toContain("mitigation details");
  });

  it("labels RSS excerpt and fetched text separately in prompts", () => {
    const promptSource = formatStoryForPrompt(story);

    expect(promptSource).toContain("RSS excerpt:");
    expect(promptSource).toContain("Fetched article text:");
    expect(promptSource).toContain("CVSS 9.8");
  });
});
