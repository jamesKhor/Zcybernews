/**
 * CertROITable — server component, dense data table.
 *
 * Editorial table (NYT/FT style): no zebra stripes, no row highlights
 * on hover, just clean borders and tight typography. Verdict gets a
 * subtle color hint via the verdict column.
 *
 * Mobile fallback: on narrow viewports, each row collapses into a
 * stacked card so columns don't overflow the viewport.
 */
import type { CertRecord } from "@/lib/salary";

interface Props {
  records: CertRecord[];
  locale: "en" | "zh";
  labels: {
    title: string;
    standfirst: string;
    colCert: string;
    colMarket: string;
    colCost: string;
    colBoost: string;
    colVerdict: string;
    colReason: string;
    vs: string;
    verdictMap: Record<string, string>;
  };
}

function verdictColor(verdict: string): string {
  if (verdict.endsWith("_wins") || verdict.includes("wins_for_jobs")) {
    return "text-emerald-500";
  }
  if (verdict === "split") return "text-amber-500";
  return "text-foreground/70";
}

function verdictLabel(verdict: string, labels: Props["labels"]): string {
  // Match the i18n keys we defined: verdict_cissp_wins, verdict_split, etc.
  const fromMap = labels.verdictMap[`verdict_${verdict}`];
  if (fromMap) return fromMap;
  // Fallback: if we don't have a label, derive from the verdict string
  if (verdict.endsWith("_wins")) {
    const winner = verdict.replace("_wins", "").toUpperCase();
    return `${winner}`;
  }
  return labels.verdictMap.verdict_default ?? verdict;
}

export function CertROITable({ records, locale, labels }: Props) {
  // Sort: highest-cost certs first (CISSP, OSCP) — typically the most
  // career-defining decisions, deserve top placement
  const sorted = [...records].sort(
    (a, b) =>
      Math.max(b.cert_a_cost_usd, b.cert_b_cost_usd) -
      Math.max(a.cert_a_cost_usd, a.cert_b_cost_usd),
  );

  return (
    <section id="cert-roi" className="my-12 sm:my-16 scroll-mt-24">
      <header className="mb-6 max-w-3xl">
        <h2 className="text-2xl sm:text-3xl font-semibold text-foreground mb-2 leading-tight">
          {labels.title}
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
          {labels.standfirst}
        </p>
      </header>

      {/* Desktop / tablet: actual table */}
      <div className="hidden md:block border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium w-[22%]">
                {labels.colCert}
              </th>
              <th className="text-left px-4 py-3 font-medium w-[12%]">
                {labels.colMarket}
              </th>
              <th className="text-left px-4 py-3 font-medium w-[20%]">
                {labels.colCost}
              </th>
              <th className="text-left px-4 py-3 font-medium w-[20%]">
                {labels.colBoost}
              </th>
              <th className="text-left px-4 py-3 font-medium w-[10%]">
                {labels.colVerdict}
              </th>
              <th className="text-left px-4 py-3 font-medium w-[16%]">
                {labels.colReason}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr
                key={r.slug}
                className={
                  i !== sorted.length - 1 ? "border-b border-border/60" : ""
                }
              >
                <td className="px-4 py-3 align-top">
                  <div className="font-mono font-semibold text-foreground">
                    {r.cert_a}
                  </div>
                  <div className="text-xs text-muted-foreground my-0.5">
                    {labels.vs}
                  </div>
                  <div className="font-mono font-semibold text-foreground/80">
                    {r.cert_b}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-foreground/80">
                  {r.market}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="text-xs text-foreground/85 leading-snug">
                    {r.cert_a_cost_local}
                  </div>
                  <div className="text-xs text-muted-foreground my-1">—</div>
                  <div className="text-xs text-foreground/85 leading-snug">
                    {r.cert_b_cost_local}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="text-xs text-foreground/85 leading-snug">
                    {r.cert_a_salary_boost}
                  </div>
                  <div className="text-xs text-muted-foreground my-1">—</div>
                  <div className="text-xs text-foreground/85 leading-snug">
                    {r.cert_b_salary_boost}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={`text-xs font-semibold ${verdictColor(r.verdict)}`}
                  >
                    {verdictLabel(r.verdict, labels)}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-xs text-muted-foreground leading-snug">
                  {r.verdict_reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-3">
        {sorted.map((r) => (
          <article key={r.slug} className="border border-border rounded-lg p-4">
            <header className="flex items-baseline justify-between gap-2 mb-3">
              <div className="font-mono text-sm font-semibold text-foreground">
                {r.cert_a}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  {labels.vs}
                </span>{" "}
                {r.cert_b}
              </div>
              <div className="text-xs text-muted-foreground">{r.market}</div>
            </header>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground uppercase tracking-wider mb-0.5">
                  {labels.colCost}
                </dt>
                <dd className="text-foreground/85 leading-snug">
                  {r.cert_a_cost_local}
                  <br />
                  {r.cert_b_cost_local}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground uppercase tracking-wider mb-0.5">
                  {labels.colBoost}
                </dt>
                <dd className="text-foreground/85 leading-snug">
                  {r.cert_a_salary_boost}
                  <br />
                  {r.cert_b_salary_boost}
                </dd>
              </div>
              <div className="pt-2 border-t border-border/40">
                <dt className="text-muted-foreground uppercase tracking-wider mb-0.5">
                  {labels.colVerdict}
                </dt>
                <dd className={`font-semibold ${verdictColor(r.verdict)} mb-1`}>
                  {verdictLabel(r.verdict, labels)}
                </dd>
                <dd className="text-muted-foreground leading-snug">
                  {r.verdict_reason}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {/* Anti-locale: small note about ZH-leaning shocking_facts */}
      {locale === "en" && (
        <p className="mt-4 text-xs text-muted-foreground italic">
          Note: original analysis is China- and APAC-focused; some commentary
          may render in Chinese.
        </p>
      )}
    </section>
  );
}
