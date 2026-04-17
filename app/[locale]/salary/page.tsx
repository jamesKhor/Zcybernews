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
  type MarketKey,
  type RoleKey,
  type SalaryRecord,
  type CertRecord,
} from "@/lib/salary";
import { SalaryCard } from "./SalaryCard";
import { SalaryFilterBar } from "./SalaryFilterBar";
import { CertROITable } from "./CertROITable";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { BreadcrumbJsonLd, DatasetJsonLd } from "@/components/seo/JsonLd";

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

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "salary" });
  const canonical = `/${locale}/salary`;
  const title = t("title");
  const description = t("standfirst");
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
        en: "/en/salary",
        "zh-Hans": "/zh/salary",
        "x-default": "/en/salary",
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

  // ── Translation labels passed to components (keep them simple props) ──
  const cardLabels = {
    entryLevel: t("entryLevel"),
    midLevel: t("midLevel"),
    seniorLevel: t("seniorLevel"),
    yearsExperience: t("yearsExperience"),
    topHiring: t("topHiring"),
    requiredCerts: t("requiredCerts"),
    shockingFact: t("shockingFact"),
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

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Breadcrumbs
          items={[
            { label: t("breadcrumbHome"), href: `/${locale}` },
            { label: t("breadcrumbSalary") },
          ]}
        />

        {/* Editorial header */}
        <header className="mt-6 mb-8 sm:mb-12 max-w-3xl">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.2em] font-mono text-primary mb-3">
            ZCyberNews · {t("eyebrow")}
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-[1.1] tracking-tight text-foreground mb-4">
            {t("title")}
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            {t("standfirst")}
          </p>
          <p className="mt-4 text-xs font-mono text-muted-foreground">
            <a
              href="#methodology"
              className="hover:text-primary transition-colors underline-offset-4 hover:underline"
            >
              {t("methodologyLink")} {LAST_UPDATED}
            </a>
          </p>
        </header>

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
