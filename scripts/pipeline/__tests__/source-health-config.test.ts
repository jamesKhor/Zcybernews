import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type RssSource = {
  id: string;
  enabled: boolean;
  url: string;
};

function readSources(): RssSource[] {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data", "rss-sources.json"),
      "utf-8",
    ),
  ) as RssSource[];
}

function readWorkflow(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), ".github", "workflows", name),
    "utf-8",
  );
}

describe("source health configuration", () => {
  it("does not enable the dead Google TAG category RSS URL", () => {
    const source = readSources().find((item) => item.id === "google-tag");

    expect(source?.url).toBe("https://blog.google/threat-analysis-group/rss/");
    expect(source?.enabled).toBe(false);
  });

  it("keeps Fortinet PSIRT enabled and runs RSS pipelines with the system CA", () => {
    const sources = readSources();
    const fortinet = sources.find((item) => item.id === "fortinet-psirt");

    expect(fortinet?.enabled).toBe(true);
    expect(fortinet?.url).toBe(
      "https://filestore.fortinet.com/fortiguard/rss/ir.xml",
    );
    expect(readWorkflow("ai-content-pipeline.yml")).toContain(
      "NODE_OPTIONS: --use-system-ca",
    );
    expect(readWorkflow("critical-vendor-watch.yml")).toContain(
      "NODE_OPTIONS: --use-system-ca",
    );
  });
});
