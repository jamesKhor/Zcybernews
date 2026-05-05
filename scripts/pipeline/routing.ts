import type { Story } from "../utils/dedup.js";
import {
  getTranslationDirection,
  type TranslationDecision,
} from "./translate-direction.js";

export type RoutedStory = Story & {
  translationDecision: TranslationDecision;
};

export type RoutingSkip = {
  story: Story;
  decision: TranslationDecision;
  reason: string;
};

export function getStoryTranslationDecision(story: Story): TranslationDecision {
  return getTranslationDirection(
    {
      id: story.sourceId ?? story.sourceName,
      seoIntent: story.seoIntent,
    },
    {
      sourceLanguage: story.sourceLanguage,
    },
  );
}

function skipReason(decision: TranslationDecision): string | null {
  if (decision.action === "ingest-signal-only") return "ingest-only";
  if (decision.action === "soft-block") return decision.reason;
  if (decision.action === "publish-zh-only") {
    return "zh-native publish not supported by current writer";
  }
  if (decision.action === "translate-and-publish-zh-only") {
    return "zh-only publish not supported by current writer";
  }
  return null;
}

export function routeStoriesForGeneration(stories: Story[]): {
  publishable: RoutedStory[];
  skipped: RoutingSkip[];
} {
  const publishable: RoutedStory[] = [];
  const skipped: RoutingSkip[] = [];

  for (const story of stories) {
    const decision = getStoryTranslationDecision(story);
    const reason = skipReason(decision);
    if (reason) {
      skipped.push({ story, decision, reason });
      continue;
    }
    publishable.push({ ...story, translationDecision: decision });
  }

  return { publishable, skipped };
}
