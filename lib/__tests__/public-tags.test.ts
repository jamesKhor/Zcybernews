import { describe, expect, it } from "vitest";
import { tagUrlSlug } from "../public-tags";

describe("tagUrlSlug", () => {
  it("normalizes tag URLs to the canonical slug shape", () => {
    expect(tagUrlSlug("Initial Access")).toBe("initial-access");
    expect(tagUrlSlug("authentication%20security")).toBe(
      "authentication-security",
    );
    expect(tagUrlSlug("CVE-2026-8957")).toBe("cve-2026-8957");
  });
});
