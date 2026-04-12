import { useTranslations } from "next-intl";
import { format } from "date-fns";
import Image from "next/image";
import type { Article } from "@/lib/content";
import {
  CATEGORY_DEFAULT_IMAGES,
  SEVERITY_COLORS,
  type Category,
  type Severity,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { stripMarkdown } from "@/lib/utils";

interface Props {
  article: Article;
  locale: string;
  type?: "posts" | "threat-intel";
}

export function ArticleCard({ article, locale, type = "posts" }: Props) {
  const t = useTranslations("article");
  const tCats = useTranslations("categories");
  const { frontmatter, readingTime } = article;

  const image =
    frontmatter.featured_image ??
    CATEGORY_DEFAULT_IMAGES[frontmatter.category as Category];
  const href = `/${locale}/${type === "threat-intel" ? "threat-intel" : "articles"}/${frontmatter.slug}`;

  return (
    <a
      href={href}
      className="group flex flex-col rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-all duration-200 overflow-hidden"
    >
      {/* Thumbnail */}
      <div className="relative h-44 bg-secondary overflow-hidden">
        {image ? (
          <Image
            src={image}
            alt={frontmatter.featured_image_alt ?? frontmatter.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            {...(image.endsWith(".svg") ? { unoptimized: true } : {})}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="font-mono text-muted-foreground text-xs">
              {"// "}
              {frontmatter.category}
            </span>
          </div>
        )}

        {/* Severity overlay badge */}
        {frontmatter.severity && (
          <span
            className={`absolute top-3 right-3 rounded-full border px-2 py-0.5 text-xs font-bold backdrop-blur-sm ${
              SEVERITY_COLORS[frontmatter.severity as Severity]
            }`}
          >
            {frontmatter.severity.toUpperCase()}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-5">
        {/* Category + date row */}
        <div className="flex items-center justify-between mb-3">
          <Badge
            variant="secondary"
            className="text-xs text-primary bg-primary/10 border-primary/20"
          >
            {tCats(frontmatter.category)}
          </Badge>
          <time
            dateTime={frontmatter.date}
            className="text-xs text-muted-foreground"
          >
            {format(new Date(frontmatter.date), "MMM d, yyyy")}
          </time>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-foreground leading-snug mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {frontmatter.title}
        </h3>

        {/* Excerpt */}
        <p className="text-sm text-muted-foreground line-clamp-2 flex-1 leading-relaxed">
          {stripMarkdown(frontmatter.excerpt)}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {t("readingTime", { minutes: readingTime })}
          </span>

          {frontmatter.threat_actor && (
            <span className="font-mono text-xs text-destructive truncate max-w-[120px]">
              {frontmatter.threat_actor}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
