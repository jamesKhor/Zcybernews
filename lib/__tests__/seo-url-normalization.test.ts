import { describe, expect, it } from "vitest";
import { canonicalPathForSeoVariant } from "../seo-url-normalization";

describe("canonicalPathForSeoVariant", () => {
  it("adds the default locale while normalizing locale-less tag paths", () => {
    expect(canonicalPathForSeoVariant("/tags/Initial Access")).toBe(
      "/en/tags/initial-access",
    );
  });

  it("normalizes uppercase tag paths", () => {
    expect(canonicalPathForSeoVariant("/zh/tags/Windows")).toBe(
      "/zh/tags/windows",
    );
  });

  it("normalizes encoded spaces in tag paths", () => {
    expect(
      canonicalPathForSeoVariant("/en/tags/authentication%20security"),
    ).toBe("/en/tags/authentication-security");
  });

  it("trims trailing hyphens from article slugs", () => {
    expect(
      canonicalPathForSeoVariant(
        "/en/articles/2026-04-17-wordpress-supply-chain-attack-infects-30-plugins-via-flippa-",
      ),
    ).toBe(
      "/en/articles/2026-04-17-wordpress-supply-chain-attack-infects-30-plugins-via-flippa",
    );
  });

  it("does not redirect already-canonical public paths", () => {
    expect(canonicalPathForSeoVariant("/en/tags/initial-access")).toBeNull();
    expect(
      canonicalPathForSeoVariant(
        "/en/articles/2026-04-17-wordpress-supply-chain-attack-infects-30-plugins-via-flippa",
      ),
    ).toBeNull();
  });

  it("ignores unrelated paths", () => {
    expect(canonicalPathForSeoVariant("/en")).toBeNull();
    expect(canonicalPathForSeoVariant("/api/feed")).toBeNull();
    expect(
      canonicalPathForSeoVariant("/en/categories/vulnerability"),
    ).toBeNull();
  });
});
