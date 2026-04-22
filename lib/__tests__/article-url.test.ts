/**
 * article-url helper tests — Phase B.3.
 *
 * Exhaustive coverage of the 4 shape dimensions (locale × section)
 * plus edge cases (slug normalization, base URL resolution, invalid
 * input). The helper exists to prevent 404s / canonical drift across
 * 6+ call-sites — the tests are what makes that guarantee real.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  articleUrl,
  absoluteArticleUrl,
  SECTION_TO_SEGMENT,
} from "../article-url";

describe("articleUrl — 4-cell matrix (2 locale × 2 section)", () => {
  it("en + posts → /en/articles/<slug>", () => {
    expect(articleUrl({ slug: "krebs-breach" }, "en", "posts")).toBe(
      "/en/articles/krebs-breach",
    );
  });

  it("en + threat-intel → /en/threat-intel/<slug>", () => {
    expect(articleUrl({ slug: "apt29" }, "en", "threat-intel")).toBe(
      "/en/threat-intel/apt29",
    );
  });

  it("zh + posts → /zh/articles/<slug>", () => {
    expect(articleUrl({ slug: "krebs-breach-zh" }, "zh", "posts")).toBe(
      "/zh/articles/krebs-breach-zh",
    );
  });

  it("zh + threat-intel → /zh/threat-intel/<slug>", () => {
    expect(articleUrl({ slug: "apt29-zh" }, "zh", "threat-intel")).toBe(
      "/zh/threat-intel/apt29-zh",
    );
  });
});

describe("SECTION_TO_SEGMENT — the posts→articles rename", () => {
  it("maps posts to articles (NOT identity)", () => {
    expect(SECTION_TO_SEGMENT.posts).toBe("articles");
  });

  it("maps threat-intel to threat-intel (identity)", () => {
    expect(SECTION_TO_SEGMENT["threat-intel"]).toBe("threat-intel");
  });
});

describe("slug normalization", () => {
  it("strips one leading slash", () => {
    expect(articleUrl({ slug: "/foo" }, "en", "posts")).toBe(
      "/en/articles/foo",
    );
  });

  it("strips one trailing slash", () => {
    expect(articleUrl({ slug: "foo/" }, "en", "posts")).toBe(
      "/en/articles/foo",
    );
  });

  it("strips multiple leading + trailing slashes", () => {
    expect(articleUrl({ slug: "///foo///" }, "en", "posts")).toBe(
      "/en/articles/foo",
    );
  });

  it("preserves hyphens and numbers", () => {
    expect(articleUrl({ slug: "cve-2026-1234-exploited" }, "en", "posts")).toBe(
      "/en/articles/cve-2026-1234-exploited",
    );
  });

  it("rejects empty slug", () => {
    expect(() => articleUrl({ slug: "" }, "en", "posts")).toThrow(/empty/);
  });

  it("rejects whitespace-only-after-strip (slash-only)", () => {
    expect(() => articleUrl({ slug: "///" }, "en", "posts")).toThrow(/empty/);
  });

  it("rejects embedded slashes (caller bug guard)", () => {
    expect(() => articleUrl({ slug: "foo/bar" }, "en", "posts")).toThrow(
      /path separator/,
    );
  });
});

describe("absoluteArticleUrl", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ENV;
    }
  });

  it("uses production default when no baseUrl and no env", () => {
    expect(absoluteArticleUrl({ slug: "foo" }, "en", "posts")).toBe(
      "https://zcybernews.com/en/articles/foo",
    );
  });

  it("uses NEXT_PUBLIC_SITE_URL when set and no override", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.zcybernews.com";
    expect(absoluteArticleUrl({ slug: "foo" }, "en", "posts")).toBe(
      "https://staging.zcybernews.com/en/articles/foo",
    );
  });

  it("explicit baseUrl overrides env", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.zcybernews.com";
    expect(
      absoluteArticleUrl(
        { slug: "foo" },
        "en",
        "posts",
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000/en/articles/foo");
  });

  it("strips trailing slash from baseUrl", () => {
    expect(
      absoluteArticleUrl({ slug: "foo" }, "en", "posts", "https://a.com/"),
    ).toBe("https://a.com/en/articles/foo");
  });

  it("strips multiple trailing slashes from baseUrl", () => {
    expect(
      absoluteArticleUrl({ slug: "foo" }, "en", "posts", "https://a.com///"),
    ).toBe("https://a.com/en/articles/foo");
  });

  it("composes correctly for zh + threat-intel (full matrix spot-check)", () => {
    expect(
      absoluteArticleUrl(
        { slug: "apt29" },
        "zh",
        "threat-intel",
        "https://zcybernews.com",
      ),
    ).toBe("https://zcybernews.com/zh/threat-intel/apt29");
  });
});

describe("purity", () => {
  it("does not mutate the input article", () => {
    const input = { slug: "foo" };
    Object.freeze(input);
    // Freezing means any mutation would throw; if this call succeeds,
    // the helper did not write to the input.
    expect(() => articleUrl(input, "en", "posts")).not.toThrow();
  });
});
