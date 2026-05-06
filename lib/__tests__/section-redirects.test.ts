import { describe, expect, it } from "vitest";
import { buildSectionRedirects } from "../section-redirects";

describe("buildSectionRedirects", () => {
  it("redirects public post slugs requested under threat-intel to articles", () => {
    const redirects = buildSectionRedirects();

    expect(redirects).toContainEqual({
      source:
        "/en/threat-intel/2026-05-04-infrastructure-breach-hackers-steal-student-data-from-canvas-platform",
      destination:
        "/en/articles/2026-05-04-infrastructure-breach-hackers-steal-student-data-from-canvas-platform",
      permanent: true,
    });
  });

  it("does not redirect canonical article URLs back to themselves", () => {
    const redirects = buildSectionRedirects();

    expect(redirects).not.toContainEqual({
      source:
        "/en/articles/2026-05-04-infrastructure-breach-hackers-steal-student-data-from-canvas-platform",
      destination:
        "/en/articles/2026-05-04-infrastructure-breach-hackers-steal-student-data-from-canvas-platform",
      permanent: true,
    });
  });
});
