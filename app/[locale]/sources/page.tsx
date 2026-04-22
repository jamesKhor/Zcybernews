/**
 * /sources — Editorial transparency page.
 *
 * Operator thesis (2026-04-22): "Security pros already subscribe to 10+
 * feeds in Feedly. Our moat is NOT faster publishing or cheaper wire
 * rewrites — it is curation + editorial judgment + the fact that we show
 * our work." This page is that proof:
 *
 *   - ACTIVE: what we read today (tier-labeled: trusted / standard)
 *   - UNDER REVIEW: on probation, monitored for signal quality
 *   - EXCLUDED: what we deliberately don't carry, with a one-line reason
 *
 * Every source links to the publisher's homepage (external, target=_blank)
 * and, where available, their RSS feed — so a reader can one-click
 * subscribe directly if they prefer the raw firehose. We don't hide our
 * upstream; we celebrate it.
 *
 * Suggestions arrive via mailto (contact@zcybernews.com) — deliberately
 * NOT a web form. Operator directive: no input surfaces we must guard.
 * Email filters + a human read is the right interface for this volume.
 *
 * Quarterly re-review is stated policy; the `lastReviewed` field is a
 * manual editorial stamp, not an mtime heuristic (files get touched for
 * reasons unrelated to editorial review).
 *
 * ISR: revalidate daily. The JSON rarely changes; when it does, ops
 * trigger revalidation via the normal content-publish path.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Rss, ExternalLink, Mail } from "lucide-react";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { BreadcrumbJsonLd, WebPageJsonLd } from "@/components/seo/JsonLd";
import sourcesDataRaw from "@/data/rss-sources.json";

export const revalidate = 86400;

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";

type Tier = "trusted" | "standard" | "under-review" | "excluded";

interface SourceRecord {
  id: string;
  name: string;
  homepage?: string;
  url: string;
  category: string;
  type: string;
  enabled: boolean;
  tier?: Tier;
  description?: string;
  whyDrop?: string;
  lastReviewed?: string;
}

const sources = sourcesDataRaw as unknown as SourceRecord[];

function groupByTier(): Record<Tier, SourceRecord[]> {
  const buckets: Record<Tier, SourceRecord[]> = {
    trusted: [],
    standard: [],
    "under-review": [],
    excluded: [],
  };
  for (const s of sources) {
    const tier = (s.tier ?? (s.enabled ? "standard" : "excluded")) as Tier;
    buckets[tier].push(s);
  }
  // Sort by name within each tier for a stable alphabetical display.
  for (const k of Object.keys(buckets) as Tier[]) {
    buckets[k].sort((a, b) => a.name.localeCompare(b.name));
  }
  return buckets;
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "sources" });
  const canonical = `${SITE_URL}/${locale}/sources`;
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical,
      languages: {
        en: `${SITE_URL}/en/sources`,
        "zh-Hans": `${SITE_URL}/zh/sources`,
      },
    },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      url: canonical,
      type: "website",
    },
  };
}

function TierBadge({ tier, label }: { tier: Tier; label: string }) {
  const styles: Record<Tier, string> = {
    trusted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    standard: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    "under-review": "bg-amber-500/10 text-amber-400 border-amber-500/30",
    excluded: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[tier]}`}
    >
      {label}
    </span>
  );
}

function SourceRow({ s, t }: { s: SourceRecord; t: (k: string) => string }) {
  const homepage = s.homepage ?? s.url;
  const tier = (s.tier ?? "standard") as Tier;
  return (
    <li className="flex flex-col gap-1.5 border-b border-border/60 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
        <a
          href={homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-foreground hover:text-primary underline-offset-4 hover:underline inline-flex items-center gap-1 min-w-0"
        >
          <span className="truncate">{s.name}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </a>
        <TierBadge tier={tier} label={t(`tier.${tier}`)} />
        {s.type === "rss" && s.url ? (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${s.name} RSS feed`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <Rss className="h-3.5 w-3.5" />
            RSS
          </a>
        ) : null}
      </div>
      {s.description ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {s.description}
        </p>
      ) : null}
      {s.whyDrop ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{t("whyDroppedLabel")}:</strong>{" "}
          {s.whyDrop}
        </p>
      ) : null}
    </li>
  );
}

export default async function SourcesPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "sources" });

  const buckets = groupByTier();
  const activeCount = buckets.trusted.length + buckets.standard.length;
  const underReviewCount = buckets["under-review"].length;
  const excludedCount = buckets.excluded.length;
  const totalTracked = sources.length;

  const mailSubject = encodeURIComponent("Feed suggestion");
  const mailBody = encodeURIComponent(
    "Hi ZCyberNews team,\n\nI'd like to suggest a source you may want to track:\n\nName: \nURL: \nWhy it's worth watching: \n\nThanks,\n",
  );
  const mailto = `mailto:contact@zcybernews.com?subject=${mailSubject}&body=${mailBody}`;

  const breadcrumbs = [
    { name: t("breadcrumbHome"), url: `${SITE_URL}/${locale}` },
    { name: t("breadcrumbSources"), url: `${SITE_URL}/${locale}/sources` },
  ];

  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbs} />
      <WebPageJsonLd
        name={t("metaTitle")}
        description={t("metaDescription")}
        url={`${SITE_URL}/${locale}/sources`}
        dateModified={new Date().toISOString()}
        inLanguage={locale === "zh" ? "zh-Hans" : "en"}
      />

      <div className="max-w-3xl mx-auto px-4 py-10 md:py-14">
        <Breadcrumbs
          items={[
            { label: t("breadcrumbHome"), href: `/${locale}` },
            { label: t("breadcrumbSources") },
          ]}
        />

        {/* Hero */}
        <header className="mt-4 mb-10">
          <h1 className="text-3xl md:text-4xl font-serif font-semibold tracking-tight text-foreground">
            {t("heroTitle")}
          </h1>
          <p className="mt-4 text-base md:text-lg text-muted-foreground leading-relaxed">
            {t("heroSubtitle")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            {t.rich("heroCounts", {
              total: totalTracked,
              active: activeCount,
              review: underReviewCount,
              excluded: excludedCount,
              strong: (chunks) => (
                <strong className="text-foreground">{chunks}</strong>
              ),
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("reviewCadence")}
          </p>
        </header>

        {/* ACTIVE — trusted first, then standard */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t("sectionActiveTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            {t("sectionActiveDescription")}
          </p>

          {buckets.trusted.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mt-6 mb-1">
                {t("tier.trusted")}
              </h3>
              <ul>
                {buckets.trusted.map((s) => (
                  <SourceRow key={s.id} s={s} t={t} />
                ))}
              </ul>
            </>
          ) : null}

          {buckets.standard.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mt-8 mb-1">
                {t("tier.standard")}
              </h3>
              <ul>
                {buckets.standard.map((s) => (
                  <SourceRow key={s.id} s={s} t={t} />
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* UNDER REVIEW */}
        {buckets["under-review"].length > 0 ? (
          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {t("sectionReviewTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {t("sectionReviewDescription")}
            </p>
            <ul>
              {buckets["under-review"].map((s) => (
                <SourceRow key={s.id} s={s} t={t} />
              ))}
            </ul>
          </section>
        ) : null}

        {/* EXCLUDED */}
        {buckets.excluded.length > 0 ? (
          <section className="mb-12">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {t("sectionExcludedTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {t("sectionExcludedDescription")}
            </p>
            <ul>
              {buckets.excluded.map((s) => (
                <SourceRow key={s.id} s={s} t={t} />
              ))}
            </ul>
          </section>
        ) : null}

        {/* Suggest a feed — mailto only, no form */}
        <section className="mt-12 rounded-lg border border-border bg-card/40 p-5">
          <h2 className="text-lg font-semibold text-foreground">
            {t("suggestTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {t("suggestBody")}
          </p>
          <a
            href={mailto}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <Mail className="h-4 w-4" />
            {t("suggestCta")}
          </a>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("suggestReplyHint")}
          </p>
        </section>

        {/* Back link */}
        <div className="mt-10 text-sm">
          <Link href={`/${locale}`} className="text-primary hover:underline">
            ← {t("backHome")}
          </Link>
        </div>
      </div>
    </>
  );
}
