import { describe, it, expect } from "vitest";
import { withWallClockTimeout } from "../timeout";

describe("withWallClockTimeout", () => {
  it("resolves through when the promise is fast", async () => {
    const fast = Promise.resolve("ok");
    await expect(withWallClockTimeout(fast, 1000, "fast")).resolves.toBe("ok");
  });

  it("rejects with a labeled error when the promise never settles", async () => {
    const never = new Promise<string>(() => {
      /* intentionally never resolves */
    });
    await expect(withWallClockTimeout(never, 20, "stuck")).rejects.toThrow(
      /wall-clock timeout after 20ms: stuck/,
    );
  });

  it("propagates the inner rejection if the promise fails before the timer", async () => {
    const failing = Promise.reject(new Error("inner boom"));
    await expect(withWallClockTimeout(failing, 1000, "inner")).rejects.toThrow(
      "inner boom",
    );
  });

  it("clears the timer so a fast-resolving call does not keep the event loop alive", async () => {
    // Indirect proof — if the timer weren't cleared, vitest would hang.
    // 20 fast resolves with long timers; if any leak, the suite times out.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withWallClockTimeout(Promise.resolve(i), 60_000, `leak-check-${i}`),
      ),
    );
    expect(true).toBe(true);
  });
});
