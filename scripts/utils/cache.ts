import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".pipeline-cache");
const PROCESSED_FILE = path.join(CACHE_DIR, "processed-urls.json");
const LOCK_FILE = `${PROCESSED_FILE}.lock`;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_ATTEMPTS = 50;
const LOCK_RETRY_DELAY_MS = 20;
let processedCache: Set<string> | null = null;
let processedDirty = false;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadProcessed(): Set<string> {
  ensureCacheDir();
  if (!fs.existsSync(PROCESSED_FILE)) return new Set();
  try {
    const data = JSON.parse(
      fs.readFileSync(PROCESSED_FILE, "utf-8"),
    ) as string[];
    return new Set(data);
  } catch (err) {
    console.warn(
      `[cache] Failed to parse ${PROCESSED_FILE}; treating as empty for this run:`,
      err instanceof Error ? err.message : err,
    );
    return new Set();
  }
}

function saveProcessed(set: Set<string>) {
  ensureCacheDir();
  const tmp = `${PROCESSED_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify([...set].sort(), null, 2));
  fs.renameSync(tmp, PROCESSED_FILE);
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireProcessedLock(): () => void {
  ensureCacheDir();

  for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          // Lock already gone.
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      try {
        const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
        if (ageMs > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {
        continue;
      }

      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error(`Timed out waiting for processed cache lock: ${LOCK_FILE}`);
}

function processedSet(): Set<string> {
  if (!processedCache) processedCache = loadProcessed();
  return processedCache;
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function isProcessed(url: string): boolean {
  return processedSet().has(hashUrl(url));
}

export function markProcessed(url: string) {
  markProcessedBatch([url]);
}

export function markProcessedBatch(urls: string[]) {
  const set = processedSet();
  for (const url of urls) {
    if (!url) continue;
    const before = set.size;
    set.add(hashUrl(url));
    if (set.size !== before) processedDirty = true;
  }
}

export function flushProcessedCache(): void {
  if (!processedCache || !processedDirty) return;
  const release = acquireProcessedLock();
  try {
    const merged = loadProcessed();
    for (const hash of processedCache) merged.add(hash);
    saveProcessed(merged);
    processedCache = merged;
    processedDirty = false;
  } finally {
    release();
  }
}

export function _resetProcessedCacheForTests(): void {
  processedCache = null;
  processedDirty = false;
}
