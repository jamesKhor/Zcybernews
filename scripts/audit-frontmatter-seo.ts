/**
 * Audit — frontmatter SEO quality across all articles.
 *
 * Template emits SEO from these frontmatter fields, so missing/weak values
 * cripple ranking even when body content is good:
 *   - title         → <title> + og:title + twitter:title (50-60 chars ideal)
 *   - excerpt       → meta description (130-160 chars ideal SERP snippet)
 *   - tags          → keywords + JSON-LD keywords (3+ ideal)
 *   - locale_pair   → hreflang alternates (cross-locale signal)
 *   - source_urls   → JSON-LD citation (credibility)
 *   - category      → routing + JSON-LD articleSection
 *   - featured_image → og:image (visible on social shares + Discover)
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

interface Issue {
  file: string;
  field: string;
  message: string;
}

function checkOne(filepath: string): Issue[] {
  const issues: Issue[] = [];
  const raw = fs.readFileSync(filepath, "utf-8");
  const { data: fm } = matter(raw);
  const f = path.basename(filepath);

  if (!fm.title || typeof fm.title !== "string") {
    issues.push({ file: f, field: "title", message: "missing" });
  } else if (fm.title.length > 70) {
    issues.push({
      file: f,
      field: "title",
      message: `${fm.title.length} chars (>70 truncates in SERP)`,
    });
  } else if (fm.title.length < 30) {
    issues.push({
      file: f,
      field: "title",
      message: `${fm.title.length} chars (<30 weak)`,
    });
  }

  if (!fm.excerpt || typeof fm.excerpt !== "string") {
    issues.push({ file: f, field: "excerpt", message: "missing" });
  } else {
    const len = fm.excerpt.length;
    if (len < 100)
      issues.push({
        file: f,
        field: "excerpt",
        message: `${len} chars (<100 weak)`,
      });
    else if (len > 200)
      issues.push({
        file: f,
        field: "excerpt",
        message: `${len} chars (>200 truncated)`,
      });
  }

  if (!fm.tags || !Array.isArray(fm.tags) || fm.tags.length === 0) {
    issues.push({ file: f, field: "tags", message: "empty" });
  } else if (fm.tags.length < 3) {
    issues.push({
      file: f,
      field: "tags",
      message: `${fm.tags.length} tags (<3 weak)`,
    });
  }

  if (!fm.locale_pair) {
    issues.push({
      file: f,
      field: "locale_pair",
      message: "missing — no hreflang link to other locale",
    });
  }

  if (
    !fm.source_urls ||
    !Array.isArray(fm.source_urls) ||
    fm.source_urls.length === 0
  ) {
    issues.push({
      file: f,
      field: "source_urls",
      message: "missing — no JSON-LD citation",
    });
  }

  if (!fm.category) {
    issues.push({ file: f, field: "category", message: "missing" });
  }

  return issues;
}

function scan(dir: string, locale: string, type: string) {
  if (!fs.existsSync(dir)) return { total: 0, issues: [] as Issue[] };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"));
  const allIssues: Issue[] = [];
  for (const f of files) {
    allIssues.push(...checkOne(path.join(dir, f)));
  }
  return { total: files.length, issues: allIssues, locale, type };
}

function summarize(label: string, r: ReturnType<typeof scan>) {
  console.log(`\n[${label}] ${r.total} articles`);
  if (r.issues.length === 0) {
    console.log(`  ✅ all clean`);
    return;
  }
  const byField = new Map<string, Issue[]>();
  for (const i of r.issues) {
    if (!byField.has(i.field)) byField.set(i.field, []);
    byField.get(i.field)!.push(i);
  }
  for (const [field, items] of [...byField.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const affected = new Set(items.map((i) => i.file)).size;
    console.log(
      `  • ${field}: ${affected} articles affected (${Math.round((100 * affected) / r.total)}%)`,
    );
    items
      .slice(0, 3)
      .forEach((i) => console.log(`      - ${i.file}: ${i.message}`));
    if (items.length > 3) console.log(`      ... and ${items.length - 3} more`);
  }
}

for (const locale of ["en", "zh"]) {
  for (const type of ["posts", "threat-intel"]) {
    const r = scan(
      path.join(process.cwd(), "content", locale, type),
      locale,
      type,
    );
    summarize(`${locale}/${type}`, r);
  }
}
