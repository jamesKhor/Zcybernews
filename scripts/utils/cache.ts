import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".pipeline-cache");
const PROCESSED_FILE = path.join(CACHE_DIR, "processed-urls.json");

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
  } catch {
    return new Set();
  }
}

function saveProcessed(set: Set<string>) {
  ensureCacheDir();
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...set], null, 2));
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function isProcessed(url: string): boolean {
  return loadProcessed().has(hashUrl(url));
}

export function markProcessed(url: string) {
  const set = loadProcessed();
  set.add(hashUrl(url));
  saveProcessed(set);
}

export function markProcessedBatch(urls: string[]) {
  const set = loadProcessed();
  for (const url of urls) set.add(hashUrl(url));
  saveProcessed(set);
}
