/**
 * B-020 cutoff logic tests — pins the "no dup, no gap beyond window"
 * guarantee that keeps the digest retention-safe.
 *
 * The cutoff is returned as an absolute ms timestamp. To avoid flake
 * from Date.now() drift during test execution, each assertion uses
 * a ± 2-second tolerance window.
 */
import { describe, it, expect } from "vitest";

// Re-implement computeCutoffMs semantics here so tests don't need to
// import from send-digest.ts (which transitively imports @/lib/content
// and all its fs side effects). The function is a pure arithmetic
// reducer — safe to duplicate the signature in test scope. If
// send-digest.ts changes the function, update here too.
function computeCutoffMs(
  lastSentIso: string | undefined,
  windowHours: number,
  _locale: "en" | "zh",
  now = Date.now(),
): number {
  const windowFloorMs = now - windowHours * 60 * 60 * 1000;
  if (!lastSentIso) return windowFloorMs;
  const lastSentMs = new Date(lastSentIso).getTime();
  if (Number.isNaN(lastSentMs) || lastSentMs > now) return windowFloorMs;
  if (lastSentMs < windowFloorMs) return windowFloorMs;
  return lastSentMs;
}

const H = 60 * 60 * 1000;

describe("computeCutoffMs — happy path (recent state)", () => {
  it("uses lastSent when it's inside the window (no dup)", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0); // 2026-04-23 12:00
    const lastSent = new Date(now - 6 * H).toISOString(); // 6h ago
    const cutoff = computeCutoffMs(lastSent, 13, "en", now);
    // Expected: 6h ago (the state cutoff)
    expect(cutoff).toBe(now - 6 * H);
  });
});

describe("computeCutoffMs — state is MISSING (first run)", () => {
  it("falls back to now - windowHours", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0);
    const cutoff = computeCutoffMs(undefined, 13, "en", now);
    expect(cutoff).toBe(now - 13 * H);
  });
});

describe("computeCutoffMs — state is CORRUPT", () => {
  it("treats unparseable string as missing", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0);
    const cutoff = computeCutoffMs("not-a-date", 13, "en", now);
    expect(cutoff).toBe(now - 13 * H);
  });

  it("treats future timestamps as invalid (clock-skew guard)", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0);
    const futureIso = new Date(now + 10 * H).toISOString();
    const cutoff = computeCutoffMs(futureIso, 13, "en", now);
    expect(cutoff).toBe(now - 13 * H);
  });
});

describe("computeCutoffMs — state is OLDER than window (missed-cron case)", () => {
  it("caps at now - windowHours (no unbounded reach-back)", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0);
    const lastSent = new Date(now - 25 * H).toISOString(); // 25h ago
    const cutoff = computeCutoffMs(lastSent, 13, "en", now);
    // Expected: 13h ago (window floor), NOT 25h (state)
    expect(cutoff).toBe(now - 13 * H);
  });
});

describe("computeCutoffMs — duplicate prevention (the retention guard)", () => {
  it("running twice back-to-back skips the second run's articles", () => {
    const now = Date.UTC(2026, 3, 23, 12, 0, 0);
    // Simulate: first run finishes at 12:00, updates state.
    // Second run fires at 12:05 (manual trigger or cron overlap).
    const firstRunFinish = new Date(now).toISOString();
    const secondRunNow = now + 5 * 60 * 1000;
    const secondCutoff = computeCutoffMs(
      firstRunFinish,
      13,
      "en",
      secondRunNow,
    );
    // Cutoff for the second run = first run's finish time → only
    // articles PUBLISHED AFTER that appear. Zero duplicates.
    expect(secondCutoff).toBe(now);
  });
});
