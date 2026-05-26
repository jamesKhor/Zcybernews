import NextLink from "next/link";
import type { ArticleLocale } from "@/lib/article-url";
import { topicHubUrl, type TopicHubDefinition } from "@/lib/topic-hubs";

interface Props {
  hubs: TopicHubDefinition[];
  locale: ArticleLocale;
}

export function ArticleTopicHubLinks({ hubs, locale }: Props) {
  if (hubs.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        {locale === "zh" ? "专题" : "Topic"}
      </span>
      {hubs.map((hub) => (
        <NextLink
          key={hub.slug}
          href={topicHubUrl(hub.slug, locale)}
          className="rounded-full border border-border px-3 py-1 font-medium text-primary hover:border-primary hover:bg-primary/5 transition-colors"
        >
          {hub.label[locale]}
        </NextLink>
      ))}
    </div>
  );
}
