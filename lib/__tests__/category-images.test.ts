import { describe, expect, it } from "vitest";
import {
  CATEGORY_DEFAULT_IMAGES,
  CATEGORY_IMAGE_POOLS,
  CategoryEnum,
  getCategoryDefaultImage,
} from "../types";

describe("category image pools", () => {
  it("keeps the original default image as the first pool item", () => {
    for (const category of CategoryEnum.options) {
      expect(CATEGORY_IMAGE_POOLS[category][0]).toBe(
        CATEGORY_DEFAULT_IMAGES[category],
      );
    }
  });

  it("adds multiple editorial banner options for the main news categories", () => {
    expect(CATEGORY_IMAGE_POOLS["threat-intel"]).toHaveLength(3);
    expect(CATEGORY_IMAGE_POOLS.vulnerabilities).toHaveLength(3);
    expect(CATEGORY_IMAGE_POOLS.malware).toHaveLength(3);
    expect(CATEGORY_IMAGE_POOLS.industry).toHaveLength(3);
  });

  it("selects a stable image for the same category and article seed", () => {
    const first = getCategoryDefaultImage(
      "vulnerabilities",
      "cisco-cve-2026-20182",
    );
    const second = getCategoryDefaultImage(
      "vulnerabilities",
      "cisco-cve-2026-20182",
    );

    expect(second).toBe(first);
    expect(CATEGORY_IMAGE_POOLS.vulnerabilities).toContain(first);
  });

  it("falls back safely for unseeded and unknown categories", () => {
    expect(getCategoryDefaultImage("malware")).toBe(
      CATEGORY_DEFAULT_IMAGES.malware,
    );
    expect(getCategoryDefaultImage("unknown-category", "anything")).toBe(
      undefined,
    );
  });
});
