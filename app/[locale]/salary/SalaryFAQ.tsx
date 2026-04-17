/**
 * SalaryFAQ — visible FAQ accordion rendered below the data sheet.
 *
 * Server component using native <details>/<summary>. No JS required.
 * Each Q&A is indexable in initial HTML so Google's FAQ rich-result
 * crawler sees the same text it sees in the FAQPage JSON-LD.
 *
 * SEO rationale: Google will NOT grant FAQ rich results if the Q&A
 * text in JSON-LD doesn't match visible page content. That's why the
 * component renders the full answer text (not collapsed-to-summary).
 */
interface Props {
  title: string;
  qa: Array<{ q: string; a: string }>;
}

export function SalaryFAQ({ title, qa }: Props) {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="my-12 sm:my-16 max-w-3xl scroll-mt-24"
    >
      <h2
        id="faq-title"
        className="text-xl sm:text-2xl font-semibold text-foreground mb-6 tracking-tight"
      >
        {title}
      </h2>
      <div className="space-y-2">
        {qa.map((item, i) => (
          <details
            key={i}
            className="group border border-border/60 rounded-md bg-card/40 open:bg-card/60 transition-colors"
            // First 2 open by default so visible FAQ content is guaranteed
            // to be in the DOM on first paint (SEO requirement).
            open={i < 2}
          >
            <summary className="cursor-pointer list-none px-5 py-4 flex items-start justify-between gap-4 font-semibold text-foreground group-hover:text-primary transition-colors">
              <span className="leading-snug">{item.q}</span>
              <span
                aria-hidden
                className="shrink-0 text-primary/70 transition-transform group-open:rotate-45 text-xl leading-none mt-0.5"
              >
                +
              </span>
            </summary>
            <div className="px-5 pb-5 -mt-1 text-sm text-muted-foreground leading-relaxed">
              {item.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
