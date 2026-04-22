import { describe, it, expect } from "vitest";
import {
  updateFeedHealth,
  type FeedHealthState,
  type FeedRunResult,
} from "../feed-health";

const run = (
  sourceId: string,
  ok: boolean,
  at: string,
  extra: Partial<FeedRunResult> = {},
): FeedRunResult => ({ sourceId, ok, at, ...extra });

describe("updateFeedHealth — first run per source", () => {
  it("creates an entry when the source has no prior state (success)", () => {
    const next = updateFeedHealth({}, [
      run("krebs", true, "2026-04-22T10:00:00Z", { items: 5 }),
    ]);
    expect(next.krebs.lastSuccess).toBe("2026-04-22T10:00:00Z");
    expect(next.krebs.lastAttempt).toBe("2026-04-22T10:00:00Z");
    expect(next.krebs.consecutiveFailures).toBe(0);
    expect(next.krebs.recent).toHaveLength(1);
    expect(next.krebs.recent[0]).toEqual({
      at: "2026-04-22T10:00:00Z",
      ok: true,
      items: 5,
    });
  });

  it("creates an entry with consecutiveFailures=1 on a first-ever failure", () => {
    const next = updateFeedHealth({}, [
      run("darkreading", false, "2026-04-22T10:00:00Z", { error: "HTTP 500" }),
    ]);
    expect(next.darkreading.lastSuccess).toBeNull();
    expect(next.darkreading.consecutiveFailures).toBe(1);
    expect(next.darkreading.recent[0].ok).toBe(false);
    expect(next.darkreading.recent[0].error).toBe("HTTP 500");
  });
});

describe("updateFeedHealth — consecutive failure counter", () => {
  it("increments on successive failures", () => {
    let state: FeedHealthState = {};
    state = updateFeedHealth(state, [
      run("x", false, "2026-04-22T01:00:00Z", { error: "e1" }),
    ]);
    state = updateFeedHealth(state, [
      run("x", false, "2026-04-22T02:00:00Z", { error: "e2" }),
    ]);
    state = updateFeedHealth(state, [
      run("x", false, "2026-04-22T03:00:00Z", { error: "e3" }),
    ]);
    expect(state.x.consecutiveFailures).toBe(3);
  });

  it("resets to 0 on any success", () => {
    let state: FeedHealthState = {};
    state = updateFeedHealth(state, [
      run("x", false, "2026-04-22T01:00:00Z", { error: "e1" }),
    ]);
    state = updateFeedHealth(state, [
      run("x", false, "2026-04-22T02:00:00Z", { error: "e2" }),
    ]);
    state = updateFeedHealth(state, [
      run("x", true, "2026-04-22T03:00:00Z", { items: 4 }),
    ]);
    expect(state.x.consecutiveFailures).toBe(0);
    expect(state.x.lastSuccess).toBe("2026-04-22T03:00:00Z");
  });
});

describe("updateFeedHealth — recent[] is bounded", () => {
  it("caps recent at 20 entries (oldest dropped)", () => {
    let state: FeedHealthState = {};
    for (let i = 0; i < 25; i++) {
      state = updateFeedHealth(state, [
        run("x", true, `2026-04-22T${String(i).padStart(2, "0")}:00:00Z`, {
          items: i,
        }),
      ]);
    }
    expect(state.x.recent).toHaveLength(20);
    // Newest first (prepend pattern) — last iteration is i=24.
    expect(state.x.recent[0].items).toBe(24);
    // Oldest remaining is i=5 (we dropped 0..4).
    expect(state.x.recent[19].items).toBe(5);
  });
});

describe("updateFeedHealth — multi-source isolation", () => {
  it("updating one source does not touch another", () => {
    const prev: FeedHealthState = {
      a: {
        lastSuccess: "2026-04-21T00:00:00Z",
        lastAttempt: "2026-04-21T00:00:00Z",
        consecutiveFailures: 0,
        recent: [{ at: "2026-04-21T00:00:00Z", ok: true, items: 3 }],
      },
    };
    const next = updateFeedHealth(prev, [
      run("b", true, "2026-04-22T00:00:00Z", { items: 1 }),
    ]);
    expect(next.a).toBe(prev.a); // same reference — no mutation
    expect(next.b).toBeDefined();
  });
});

describe("updateFeedHealth — error-message capping", () => {
  it("truncates error messages at 200 chars", () => {
    const longError = "x".repeat(500);
    const next = updateFeedHealth({}, [
      run("x", false, "2026-04-22T00:00:00Z", { error: longError }),
    ]);
    expect(next.x.recent[0].error).toHaveLength(200);
  });
});
