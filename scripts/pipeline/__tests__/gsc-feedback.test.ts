import { describe, expect, it } from "vitest";
import { buildGscDemandHints, parseGscCsv, readGscRows } from "../gsc-feedback";

describe("GSC feedback import", () => {
  it("parses quoted CSV cells and numeric Search Console fields", () => {
    const records = parseGscCsv(
      [
        "Query,Clicks,Impressions,CTR,Position",
        '"openai, daybreak",12,240,5%,7.4',
      ].join("\n"),
    );

    expect(records).toEqual([
      {
        Query: "openai, daybreak",
        Clicks: "12",
        Impressions: "240",
        CTR: "5%",
        Position: "7.4",
      },
    ]);

    expect(readGscRows(records)).toEqual([
      {
        query: "openai, daybreak",
        page: undefined,
        clicks: 12,
        impressions: 240,
        ctr: 0.05,
        position: 7.4,
        indexingStatus: undefined,
      },
    ]);
  });

  it("builds demand hints from query exports while excluding navigational noise", () => {
    const hints = buildGscDemandHints(
      readGscRows(
        parseGscCsv(
          [
            "Top queries,Clicks,Impressions,CTR,Position",
            "openai daybreak cybersecurity,8,300,2.7%,6.2",
            "site:zcybernews.com,30,400,7.5%,1",
            "zcybernews,100,120,83%,1",
            "lockbit hospital ransomware,1,180,0.6%,11",
          ].join("\n"),
        ),
      ),
      { generatedAt: "2026-05-26T00:00:00.000Z" },
    );

    expect(hints.generatedAt).toBe("2026-05-26T00:00:00.000Z");
    expect(hints.entities["openai daybreak cybersecurity"]).toBeGreaterThan(
      0.65,
    );
    expect(hints.entities["lockbit hospital ransomware"]).toBeGreaterThan(0.5);
    expect(hints.entities["site:zcybernews.com"]).toBeUndefined();
    expect(hints.entities.zcybernews).toBeUndefined();
    expect(hints.summary.queryRows).toBe(4);
    expect(hints.summary.importedQueries).toBe(2);
  });
});
