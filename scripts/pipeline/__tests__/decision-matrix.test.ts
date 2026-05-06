import { describe, expect, it } from "vitest";
import {
  formatDecisionMatrixForTelegram,
  summarizeDecisionMatrix,
  type DecisionMatrixEntry,
} from "../decision-matrix";

const entries: DecisionMatrixEntry[] = [
  {
    index: 1,
    outcome: "not_published",
    sourceTitle: "Vendor says product is affected by CVE-2026-1234",
    sourceName: "vendor",
    stage: "quality",
    decision: "not published",
    reasons: ["missing_references"],
    gates: [
      { gate: "routing", outcome: "pass", detail: "publish-en-only" },
      { gate: "quality", outcome: "block", detail: "missing_references" },
    ],
  },
  {
    index: 0,
    outcome: "published",
    sourceTitle: "Actor exploits edge device",
    sourceName: "research",
    articleTitle: "Actor Exploits Edge Device in Enterprise Intrusions",
    category: "threat-intel",
    severity: "high",
    stage: "write",
    decision: "published",
    reasons: ["passed publish gates"],
    gates: [
      {
        gate: "routing",
        outcome: "pass",
        detail: "translate-and-publish-both",
      },
      { gate: "generation", outcome: "pass", detail: "threat-intel/high" },
      { gate: "fact-check", outcome: "pass" },
      { gate: "quality", outcome: "pass", detail: "headline=84 words=820" },
      { gate: "write", outcome: "pass", detail: "en+zh" },
    ],
  },
];

describe("decision matrix", () => {
  it("summarizes published and not-published outcomes", () => {
    expect(summarizeDecisionMatrix(entries)).toMatchObject({
      total: 2,
      published: 1,
      notPublished: 1,
      byStage: {
        write: 1,
        quality: 1,
      },
      byReason: {
        "passed publish gates": 1,
        missing_references: 1,
      },
    });
  });

  it("formats Telegram-safe publish and skip rationale", () => {
    const text = formatDecisionMatrixForTelegram(entries);

    expect(text).toContain("<b>Decision gates</b>");
    expect(text).toContain("Published: 1 | Not published: 1");
    expect(text).toContain("<b>Why published</b>");
    expect(text).toContain("<b>Why not published</b>");
    expect(text).toContain("quality: missing_references");
  });

  it("escapes candidate-provided HTML without stripping formatter tags", () => {
    const text = formatDecisionMatrixForTelegram([
      {
        ...entries[0]!,
        sourceTitle: 'Bad <b>tag</b> & "unsafe" title',
      },
    ]);

    expect(text).toContain("<b>Decision gates</b>");
    expect(text).toContain("Bad &lt;b&gt;tag&lt;/b&gt; &amp;");
  });
});
