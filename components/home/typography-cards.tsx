import Link from "next/link";
import { stripMarkdown } from "@/lib/utils";
import type { Article } from "@/lib/content";

/**
 * Typography-forward card variants (Phase 2, 2026-04-18).
 *
 * Each card has a BIG editorial hero element instead of a photo.
 * Reader scans the hero and decides which card to read. This creates
 * per-category visual rhythm:
 *   VulnCard     → CVSS score (9.8 / 8.1 / 6.4) colored by severity
 *   MalwareCard  → Threat actor name (LockBit 4.0 / REF6598)
 *   IndustryCard → Entity/company name (McGraw-Hill / Google / UK ICO)
 *   AICard       → Provider or attack class (Anthropic / Prompt Injection)
 *
 * All 4 share the same card frame + footer shape. Only the hero
 * element differs.
 */

interface CardProps {
  article: Article;
  locale: string;
}

const SEVERITY_HSL: Record<string, string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
  informational: "var(--severity-info)",
};

function hrefFor(
  article: Article,
  locale: string,
  sourceType: "posts" | "threat-intel",
): string {
  const seg = sourceType === "threat-intel" ? "threat-intel" : "articles";
  return `/${locale}/${seg}/${article.frontmatter.slug}`;
}

/** Shared frame around the big hero + meta below. Keeps all typography
    cards visually consistent while the HERO slot varies by category. */
function CardFrame({
  href,
  hero,
  title,
  meta,
  tags,
}: {
  href: string;
  hero: React.ReactNode;
  title: string;
  meta: string;
  tags: string[];
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-md border border-border bg-card hover:border-foreground/20 transition-colors overflow-hidden"
    >
      {/* Hero slot — centered, generous padding, big typography */}
      <div className="flex items-center justify-center min-h-[140px] p-6 border-b border-border/60">
        {hero}
      </div>

      {/* Body — title, meta, tags */}
      <div className="flex flex-col gap-2 p-5 flex-1">
        <h3 className="font-serif text-base sm:text-lg font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-3">
          {title}
        </h3>

        <p className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {meta}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-2">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-mono uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm border border-border/60 bg-background/40 text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── VulnCard — CVSS score is the hero ─────────────────────────────────

function cvssBand(
  score: number,
): "critical" | "high" | "medium" | "low" | "info" {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score > 0) return "low";
  return "info";
}

export function VulnCard({
  article,
  locale,
  sourceType,
}: CardProps & { sourceType: "posts" | "threat-intel" }) {
  const { frontmatter } = article;
  const score = frontmatter.cvss_score;
  const severity =
    typeof score === "number"
      ? cvssBand(score)
      : (frontmatter.severity ?? "informational");
  const color = SEVERITY_HSL[severity];

  return (
    <CardFrame
      href={hrefFor(article, locale, sourceType)}
      hero={
        <div className="text-center">
          <p
            className="font-serif font-black leading-none tabular-nums"
            style={{
              color: `hsl(${color})`,
              fontSize: "clamp(3rem, 9vw, 4.5rem)",
            }}
          >
            {typeof score === "number" ? score.toFixed(1) : "—"}
          </p>
          <p
            className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] font-bold"
            style={{ color: `hsl(${color})` }}
          >
            {severity}
          </p>
        </div>
      }
      title={frontmatter.title}
      meta={
        frontmatter.cve_ids && frontmatter.cve_ids.length > 0
          ? frontmatter.cve_ids[0]
          : `${new Date(frontmatter.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      }
      tags={frontmatter.tags ?? []}
    />
  );
}

// ─── MalwareCard — Threat actor name is the hero ───────────────────────

export function MalwareCard({
  article,
  locale,
  sourceType,
}: CardProps & { sourceType: "posts" | "threat-intel" }) {
  const { frontmatter } = article;
  const actor = frontmatter.threat_actor ?? "—";
  // "Family" is derived from tags — first match against known family keywords
  const familyTag = (frontmatter.tags ?? []).find((t) =>
    /^(ransomware|apt|rat|trojan|worm|botnet|stealer|backdoor|wiper|loader)$/i.test(
      t,
    ),
  );
  const family = familyTag?.toUpperCase() ?? "MALWARE";

  return (
    <CardFrame
      href={hrefFor(article, locale, sourceType)}
      hero={
        <div className="text-center">
          <p className="font-serif font-bold leading-[1.05] tracking-tight text-foreground">
            <span
              style={{
                fontSize: "clamp(1.5rem, 5vw, 2.25rem)",
              }}
            >
              {actor}
            </span>
          </p>
          <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-[hsl(var(--cat-malware))]">
            {family}
          </p>
        </div>
      }
      title={frontmatter.title}
      meta={`${new Date(frontmatter.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${frontmatter.severity?.toUpperCase() ?? "—"}`}
      tags={frontmatter.tags ?? []}
    />
  );
}

// ─── IndustryCard — Entity/company name is the hero ────────────────────

/** Extract the first proper-noun-like phrase from an article title.
    Works well for industry titles like "McGraw-Hill Data Breach..." →
    "McGraw-Hill", or "Google Tightens..." → "Google". Falls back to
    category name if nothing extractable. */
function extractEntity(title: string): string {
  // Match: capitalized words at start, up to 2 of them, stopping at a
  // verb-like lowercase word. Handles "UK ICO" (2 caps) and "McGraw-Hill"
  // (hyphen) and "Google" (1 word).
  const match = title.match(/^((?:[A-Z][\w'-]*\s?){1,3})/);
  if (!match) return title.split(" ").slice(0, 2).join(" ");
  return match[1].trim();
}

export function IndustryCard({
  article,
  locale,
  sourceType,
}: CardProps & { sourceType: "posts" | "threat-intel" }) {
  const { frontmatter } = article;
  const entity = extractEntity(frontmatter.title);
  const angleTag = frontmatter.tags?.[0]?.toUpperCase() ?? "INDUSTRY";

  return (
    <CardFrame
      href={hrefFor(article, locale, sourceType)}
      hero={
        <div className="text-center">
          <p
            className="font-serif font-bold leading-[1.05] tracking-tight text-foreground"
            style={{
              fontSize: "clamp(1.5rem, 5vw, 2.25rem)",
            }}
          >
            {entity}
          </p>
          <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-[hsl(var(--cat-industry))]">
            {angleTag}
          </p>
        </div>
      }
      title={frontmatter.title.slice(entity.length).trim() || frontmatter.title}
      meta={`${new Date(frontmatter.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${frontmatter.severity?.toUpperCase() ?? "INFO"}`}
      tags={frontmatter.tags ?? []}
    />
  );
}

// ─── AICard — Provider or attack class is the hero ─────────────────────

const AI_PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Meta",
  "Microsoft",
  "Claude",
  "GPT",
  "Gemini",
  "Llama",
  "DeepSeek",
  "Mistral",
] as const;

const AI_ATTACK_CLASSES = [
  "Prompt Injection",
  "Jailbreak",
  "Memory",
  "Agentic AI",
  "Model Theft",
  "Poisoning",
  "Exfiltration",
] as const;

function extractAIHero(title: string): { hero: string; role: string } {
  // Try provider first
  for (const p of AI_PROVIDERS) {
    if (title.includes(p)) return { hero: p, role: "PROVIDER" };
  }
  // Try attack class
  for (const c of AI_ATTACK_CLASSES) {
    if (title.toLowerCase().includes(c.toLowerCase())) {
      return { hero: c, role: "ATTACK VECTOR" };
    }
  }
  // Fallback: first word
  return { hero: title.split(" ")[0], role: "AI SECURITY" };
}

export function AICard({
  article,
  locale,
  sourceType,
}: CardProps & { sourceType: "posts" | "threat-intel" }) {
  const { frontmatter } = article;
  const { hero, role } = extractAIHero(frontmatter.title);

  return (
    <CardFrame
      href={hrefFor(article, locale, sourceType)}
      hero={
        <div className="text-center">
          <p
            className="font-serif font-bold leading-[1.05] tracking-tight text-foreground"
            style={{
              fontSize: "clamp(1.5rem, 5vw, 2.25rem)",
            }}
          >
            {hero}
          </p>
          <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.2em] font-bold text-[hsl(var(--cat-ai))]">
            {role}
          </p>
        </div>
      }
      title={frontmatter.title}
      meta={`${new Date(frontmatter.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${frontmatter.severity?.toUpperCase() ?? "INFO"}`}
      tags={frontmatter.tags ?? []}
    />
  );
}

// ─── Generic typography card (for any category that doesn't have a custom one) ─

export function GenericTypographyCard({
  article,
  locale,
  sourceType,
}: CardProps & { sourceType: "posts" | "threat-intel" }) {
  const { frontmatter } = article;
  const severity = frontmatter.severity ?? "informational";
  const sevColor = SEVERITY_HSL[severity];
  const excerpt = stripMarkdown(frontmatter.excerpt);

  return (
    <Link
      href={hrefFor(article, locale, sourceType)}
      className="group flex flex-col gap-3 pl-5 pr-4 py-4 rounded-r border-l-4 border-border bg-card hover:bg-secondary/40 transition-colors"
      style={{ borderLeftColor: `hsl(${sevColor})` }}
    >
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] font-semibold">
        <span style={{ color: `hsl(${sevColor})` }}>{severity}</span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-muted-foreground">
          {new Date(frontmatter.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
      <h3 className="font-serif text-base sm:text-lg font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-3">
        {frontmatter.title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
        {excerpt}
      </p>
    </Link>
  );
}
