import fs from "fs";
import path from "path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  _resetProcessedCacheForTests,
  flushProcessedCache,
  hashUrl,
  isProcessed,
  markProcessed,
  markProcessedBatch,
} from "./cache";

const CACHE_DIR = path.join(process.cwd(), ".pipeline-cache");
const PROCESSED_FILE = path.join(CACHE_DIR, "processed-urls.json");
const LOCK_FILE = `${PROCESSED_FILE}.lock`;

let originalContent: string | null = null;

function cleanTestFile() {
  _resetProcessedCacheForTests();
  if (fs.existsSync(PROCESSED_FILE)) fs.unlinkSync(PROCESSED_FILE);
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
}

describe("processed URL cache", () => {
  beforeAll(() => {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    originalContent = fs.existsSync(PROCESSED_FILE)
      ? fs.readFileSync(PROCESSED_FILE, "utf-8")
      : null;
    cleanTestFile();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanTestFile();
  });

  afterAll(() => {
    _resetProcessedCacheForTests();
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (originalContent === null) {
      if (fs.existsSync(PROCESSED_FILE)) fs.unlinkSync(PROCESSED_FILE);
    } else {
      fs.writeFileSync(PROCESSED_FILE, originalContent, "utf-8");
    }
  });

  it("keeps marks in memory until an explicit flush", () => {
    markProcessed("https://example.com/a");

    expect(isProcessed("https://example.com/a")).toBe(true);
    expect(fs.existsSync(PROCESSED_FILE)).toBe(false);

    flushProcessedCache();

    expect(JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf-8"))).toEqual([
      hashUrl("https://example.com/a"),
    ]);
  });

  it("persists multiple batch marks with one atomic write", () => {
    markProcessedBatch(["https://example.com/a"]);
    markProcessedBatch(["https://example.com/b"]);

    flushProcessedCache();

    const saved = JSON.parse(
      fs.readFileSync(PROCESSED_FILE, "utf-8"),
    ) as string[];
    expect(saved).toEqual([
      hashUrl("https://example.com/a"),
      hashUrl("https://example.com/b"),
    ]);
  });

  it("merges hashes written by another process before flushing", () => {
    markProcessed("https://example.com/a");
    fs.writeFileSync(
      PROCESSED_FILE,
      JSON.stringify([hashUrl("https://example.com/b")], null, 2),
      "utf-8",
    );

    flushProcessedCache();

    const saved = JSON.parse(
      fs.readFileSync(PROCESSED_FILE, "utf-8"),
    ) as string[];
    expect(saved).toEqual([
      hashUrl("https://example.com/a"),
      hashUrl("https://example.com/b"),
    ]);
  });

  it("warns on malformed cache JSON instead of silently resetting", () => {
    fs.writeFileSync(PROCESSED_FILE, "{not-json", "utf-8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(isProcessed("https://example.com/a")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[cache] Failed to parse"),
      expect.any(String),
    );

    markProcessed("https://example.com/a");
    flushProcessedCache();

    expect(JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf-8"))).toEqual([
      hashUrl("https://example.com/a"),
    ]);
  });
});
