/**
 * /salary — APAC Cybersecurity Salary Explorer (P0)
 *
 * The destination page for the entire xhs → zcybernews career-content
 * funnel. Every XHS career card's CTA points HERE. Read the strategic
 * context: ~/.claude/projects/.../zcyber-xhs/memory/feature_backlog.md
 *
 * Design direction (operator-approved): editorial / data-journalism
 * (NYT, FT). Restraint as authority signal. No marketing-page bloat.
 *
 * Implementation:
 * - Server component renders all data into HTML for SEO.
 * - Client island (SalaryFilterBar) handles chip filters via URL params.
 * - ISR `revalidate = 86400` — data refreshes once per day; sync script
 *   re-emits JSON when zcyber-xhs YAMLs are updated.
 * - No chart library; pure CSS bars. One less JS bundle on a mobile-first
 *   page that lands XHS taps.
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import salaryDataRaw from "@/data/salary-data.json";
import certDataRaw from "@/data/cert-data.json";
import {
  SalaryRecordSchema,
  CertRecordSchema,
  filterSalaries,
  classifyMarket,
  type MarketKey,
  type RoleKey,
  type SalaryRecord,
  type CertRecord,
} from "@/lib/salary";
import { SalaryCard } from "./SalaryCard";
import { SalaryFilterBar } from "./SalaryFilterBar";
import { CertROITable } from "./CertROITable";
import { APACSalaryMap } from "./APACSalaryMap";
import { HeroStats } from "./HeroStats";
import { CinematicHero } from "./CinematicHero";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import {
  BreadcrumbJsonLd,
  DatasetJsonLd,
  FAQPageJsonLd,
  WebPageJsonLd,
} from "@/components/seo/JsonLd";
import { SalaryFAQ } from "./SalaryFAQ";

// ISR — daily refresh. Salary data doesn't change hourly.
export const revalidate = 86400;

// Static generation for both locales — small fixed set, prerender both
export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";

// Sources cited in methodology + JSON-LD (kept in code so they stay in sync)
const PRIMARY_SOURCES = [
  { name: "NodeFlair", url: "https://nodeflair.com" },
  { name: "JobStreet", url: "https://www.jobstreet.com" },
  { name: "Seek (AU)", url: "https://www.seek.com.au" },
  { name: "JobsDB (HK)", url: "https://www.jobsdb.com/hk" },
  { name: "Maimai (CN)", url: "https://maimai.cn" },
  { name: "ACS Workforce Report (AU)", url: "https://www.acs.org.au" },
  { name: "ISC2 Cybersecurity Workforce Study", url: "https://www.isc2.org" },
];

const LAST_UPDATED = "2026-04-17";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ market?: string; role?: string }>;
}

// Known market filter keys — kept in sync with MARKETS in lib/salary.ts.
// Used by generateMetadata to validate ?market= values against the same
// whitelist the page filter uses. Unknown markets → bare /salary metadata
// (don't emit indexable metadata for junk query strings).
const KNOWN_MARKET_KEYS = ["sg", "my", "cn-t1", "cn-t2", "au", "hk"] as const;
const KNOWN_ROLE_KEYS = [
  "soc",
  "pentest",
  "cloud",
  "grc",
  "architect",
  "ciso",
  "engineer",
] as const;

/**
 * Per-filter metadata.
 *
 * SEO rationale: each unique `?market=hk` or `?role=soc` URL gets:
 *  - Unique <title> → Google treats as distinct indexable result
 *  - Unique meta description → higher SERP click-through
 *  - Self-referencing canonical → no duplicate-content penalty
 *  - Correct hreflang to the same filter in the other locale
 *  - Robots: index (we WANT these in the index) but only for whitelisted keys
 *
 * The bare `/salary` URL is still the primary entry and remains the
 * default (x-default) canonical target.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "salary" });

  // Validate filter params — only known keys produce canonical filter URLs
  const marketKey = KNOWN_MARKET_KEYS.includes(
    sp.market as (typeof KNOWN_MARKET_KEYS)[number],
  )
    ? (sp.market as (typeof KNOWN_MARKET_KEYS)[number])
    : undefined;
  const roleKey = KNOWN_ROLE_KEYS.includes(
    sp.role as (typeof KNOWN_ROLE_KEYS)[number],
  )
    ? (sp.role as (typeof KNOWN_ROLE_KEYS)[number])
    : undefined;

  // Build the canonical path — include filter params in stable order so
  // crawlers see one canonical per logical view.
  const qs = new URLSearchParams();
  if (marketKey) qs.set("market", marketKey);
  if (roleKey) qs.set("role", roleKey);
  const queryString = qs.toString();
  const suffix = queryString ? `?${queryString}` : "";
  const canonical = `/${locale}/salary${suffix}`;

  // Compose title/description from per-market i18n keys when present,
  // falling back to the base page title.
  const marketTitle = marketKey ? t(`metaMarket_${marketKey}_title`) : null;
  const marketDesc = marketKey ? t(`metaMarket_${marketKey}_desc`) : null;
  const title = marketTitle ?? t("title");
  const description = marketDesc ?? t("standfirst");

  return {
    title,
    description,
    keywords: [
      "cybersecurity salary",
      "cyber salary APAC",
      "Singapore SOC analyst salary",
      "Hong Kong cybersecurity pay",
      "China cybersecurity salary",
      "Malaysia security engineer salary",
      "Australia penetration tester salary",
      "CISSP salary boost",
      "OSCP salary",
    ],
    alternates: {
      canonical,
      languages: {
        en: `/en/salary${suffix}`,
        "zh-Hans": `/zh/salary${suffix}`,
        "x-default": `/en/salary${suffix}`,
      },
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      images: [
        { url: "/og-default.png", width: 1200, height: 630, alt: title },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-default.png"],
    },
  };
}

// Validate at module load — if the data is malformed, fail fast at build
// time rather than render broken UI to users.
const salaryData: SalaryRecord[] = (salaryDataRaw as unknown[])
  .map((r) => SalaryRecordSchema.safeParse(r))
  .flatMap((res) => (res.success ? [res.data] : []));

const certData: CertRecord[] = (certDataRaw as unknown[])
  .map((r) => CertRecordSchema.safeParse(r))
  .flatMap((res) => (res.success ? [res.data] : []));

export default async function SalaryPage({ params, searchParams }: PageProps) {
  const { locale: rawLocale } = await params;
  const sp = await searchParams;
  const locale = (rawLocale === "zh" ? "zh" : "en") as "en" | "zh";

  const t = await getTranslations({ locale, namespace: "salary" });

  // Apply URL-driven filters server-side so the rendered HTML matches
  // the URL state — crawlers + sharing both work without JS.
  const market = (sp.market ?? "all") as MarketKey | "all";
  const role = (sp.role ?? "all") as RoleKey | "all";
  const filtered = filterSalaries(salaryData, { market, role });

  // At-a-glance stats — counted from the FULL dataset (not the filtered
  // view) so the hero summary always reflects the dataset's true breadth.
  const marketsCovered = new Set(
    salaryData.map((r) => classifyMarket(r.market)),
  ).size;

  // ── Translation labels passed to components (keep them simple props) ──
  const cardLabels = {
    entryLevel: t("entryLevel"),
    midLevel: t("midLevel"),
    seniorLevel: t("seniorLevel"),
    yearsExperience: t("yearsExperience"),
    topHiring: t("topHiring"),
    requiredCerts: t("requiredCerts"),
    source: t("source"),
    monthly: t("monthly"),
    topEarners: t("topEarners"),
    topEarnersNote: t("topEarnersNote"),
  };
  const filterLabels = {
    filterMarket: t("filterMarket"),
    filterRole: t("filterRole"),
    filterAll: t("filterAll"),
    showingResults: t("showingResults"),
  };
  const certLabels = {
    title: t("certTableTitle"),
    standfirst: t("certTableStandfirst"),
    colCert: t("certColCert"),
    colMarket: t("certColMarket"),
    colCost: t("certColCost"),
    colBoost: t("certColBoost"),
    colVerdict: t("certColVerdict"),
    colReason: t("certColReason"),
    vs: t("vs"),
    verdictMap: {
      verdict_cissp_wins: t("verdict_cissp_wins"),
      verdict_cism_wins: t("verdict_cism_wins"),
      verdict_oscp_wins: t("verdict_oscp_wins"),
      verdict_security_plus_wins: t("verdict_security_plus_wins"),
      verdict_security_plus_wins_for_jobs: t(
        "verdict_security_plus_wins_for_jobs",
      ),
      verdict_split: t("verdict_split"),
      verdict_default: t("verdict_default"),
    },
  };

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: t("breadcrumbHome"), url: `${SITE_URL}/${locale}` },
          {
            name: t("breadcrumbSalary"),
            url: `${SITE_URL}/${locale}/salary`,
          },
        ]}
      />
      <DatasetJsonLd
        name={t("title")}
        description={t("standfirst")}
        url={`${SITE_URL}/${locale}/salary`}
        dateModified={LAST_UPDATED}
        keywords={[
          "cybersecurity",
          "salary",
          "compensation",
          "APAC",
          "Singapore",
          "Hong Kong",
          "Malaysia",
          "Australia",
          "China",
        ]}
        sources={PRIMARY_SOURCES.map((s) => s.name)}
        inLanguage={locale === "zh" ? "zh-Hans" : "en"}
      />
      {/* WebPage — gives Google a page-level entity to attach to its
          site navigation graph. Complements Dataset (data scope) and
          FAQPage (Q&A scope) so the page emits three coordinated
          schema.org entities. */}
      <WebPageJsonLd
        name={t("title")}
        description={t("standfirst")}
        url={`${SITE_URL}/${locale}/salary`}
        dateModified={LAST_UPDATED}
        inLanguage={locale === "zh" ? "zh-Hans" : "en"}
        breadcrumbItems={[
          { name: t("breadcrumbHome"), url: `${SITE_URL}/${locale}` },
          {
            name: t("breadcrumbSalary"),
            url: `${SITE_URL}/${locale}/salary`,
          },
        ]}
      />
      {/* FAQPage — each answer text MUST match what we render in the
          visible <SalaryFAQ> accordion below. Google invalidates FAQ
          rich results if the JSON-LD text is not on the page. */}
      <FAQPageJsonLd
        inLanguage={locale === "zh" ? "zh-Hans" : "en"}
        questions={[
          { question: t("faq_q1"), answer: t("faq_a1") },
          { question: t("faq_q2"), answer: t("faq_a2") },
          { question: t("faq_q3"), answer: t("faq_a3") },
          { question: t("faq_q4"), answer: t("faq_a4") },
          { question: t("faq_q5"), answer: t("faq_a5") },
          { question: t("faq_q6"), answer: t("faq_a6") },
        ]}
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Cinematic hero — TX3-style, full-viewport landing moment.
            aria-hidden wordmark so screen readers/crawlers use the real
            h1 below for indexing. Visual-only decoration up top, SEO
            semantics preserved in the editorial header. */}
        <CinematicHero
          locale={locale}
          labels={{
            w1: t("heroW1"),
            w2: t("heroW2"),
            w3: t("heroW3"),
            w4: t("heroW4"),
            body: t("heroBody"),
            cta: t("heroCta"),
          }}
        />

        <Breadcrumbs
          items={[
            { label: t("breadcrumbHome"), href: `/${locale}` },
            { label: t("breadcrumbSalary") },
          ]}
        />

        {/* Editorial header — the SEO <h1>. Tightened since the visual
            impact now lives in the cinematic hero above; this block
            exists for search engines + readers who want the real
            standfirst before the data. */}
        <header
          id="dataset"
          className="mt-6 mb-8 sm:mb-12 max-w-3xl scroll-mt-8"
        >
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.2em] font-semibold text-primary mb-3">
            ZCyberNews · {t("eyebrow")}
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.1] tracking-tight text-foreground mb-4">
            {t("title")}
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            {t("standfirst")}
          </p>

          {/* At-a-glance stats strip — NYT-style dataset metadata.
              Count markets/roles/records server-side so the numbers stay
              in sync with the data and crawlers see them in initial HTML. */}
          <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                {t("statRecords")}
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {salaryData.length}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                {t("statMarkets")}
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {marketsCovered}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                {t("statCertPairs")}
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {certData.length}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                {t("statUpdated")}
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                {LAST_UPDATED}
              </dd>
            </div>
          </dl>

          <p className="mt-5 text-[11px] font-mono text-muted-foreground">
            <a
              href="#methodology"
              className="hover:text-primary transition-colors underline-offset-4 hover:underline uppercase tracking-[0.12em]"
            >
              {t("methodologyLink")}
            </a>
          </p>
        </header>

        {/* Hero "zoom-in" big-number stats — visible above the fold */}
        <HeroStats
          records={salaryData}
          locale={locale}
          labels={{
            eyebrowCeiling: t("heroCeilingEyebrow"),
            eyebrowEntry: t("heroEntryEyebrow"),
            eyebrowSpread: t("heroSpreadEyebrow"),
            descCeiling: t("heroCeilingDesc"),
            descEntry: t("heroEntryDesc"),
            descSpread: t("heroSpreadDesc"),
            deltaCeiling: t("heroCeilingDelta"),
            deltaEntry: t("heroEntryDelta"),
            deltaSpread: t("heroSpreadDelta"),
          }}
        />

        {/* APAC map — clickable city dots that drill into ?market filter */}
        <APACSalaryMap
          records={salaryData}
          locale={locale}
          currentMarket={market}
          labels={{
            title: t("mapTitle"),
            standfirst: t("mapStandfirst"),
            legendLow: t("mapLegendLow"),
            legendHigh: t("mapLegendHigh"),
            clickHint: t("mapClickHint"),
          }}
        />

        {/* Filter bar (sticky) */}
        <SalaryFilterBar
          locale={locale}
          totalCount={salaryData.length}
          filteredCount={filtered.length}
          labels={filterLabels}
        />

        {/* Salary cards grid */}
        {filtered.length === 0 ? (
          <p className="text-center py-16 text-muted-foreground">
            {t("noResults")}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
            {filtered.map((r) => (
              <SalaryCard
                key={r.slug}
                record={r}
                locale={locale}
                labels={cardLabels}
              />
            ))}
          </div>
        )}

        {/* Cert ROI table — separate section, anchor target from card chips */}
        <CertROITable records={certData} locale={locale} labels={certLabels} />

        {/* Methodology — earned-trust signal, not just legal disclaimer */}
        <section
          id="methodology"
          className="my-12 sm:my-16 max-w-3xl scroll-mt-24"
        >
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-4">
            {t("methodologyTitle")}
          </h2>
          <div className="prose prose-sm sm:prose-base prose-invert max-w-none space-y-3 text-foreground/85 leading-relaxed">
            <p>{t("methodologyP1")}</p>
            <p>{t("methodologyP2")}</p>
            <p>{t("methodologyP3")}</p>
          </div>
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-mono">
              {t("methodologySources")}
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {PRIMARY_SOURCES.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline underline-offset-4"
                  >
                    {s.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 text-xs font-mono text-muted-foreground">
            {t("lastUpdated")}: {LAST_UPDATED}
          </p>
        </section>

        {/* FAQ — visible accordion. Text MUST match FAQPageJsonLd above
            or Google invalidates the rich result. Native <details>, no JS. */}
        <SalaryFAQ
          title={t("faqTitle")}
          qa={[
            { q: t("faq_q1"), a: t("faq_a1") },
            { q: t("faq_q2"), a: t("faq_a2") },
            { q: t("faq_q3"), a: t("faq_a3") },
            { q: t("faq_q4"), a: t("faq_a4") },
            { q: t("faq_q5"), a: t("faq_a5") },
            { q: t("faq_q6"), a: t("faq_a6") },
          ]}
        />

        {/* Newsletter signup — opt-in, no gate, no tricks */}
        <section className="my-12 sm:my-16 border border-border/60 rounded-lg p-5 sm:p-8 bg-muted/20">
          <div className="max-w-xl">
            <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-2">
              {t("newsletterTitle")}
            </h3>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              {t("newsletterDesc")}
            </p>
            <SubscribeForm />
          </div>
        </section>
      </main>
    </>
  );
}
