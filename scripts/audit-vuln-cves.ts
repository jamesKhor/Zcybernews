/**
 * Audit — how many vulnerabilities-category articles lack a CVE ID in body?
 * Also flags placeholder-CVE tokens still sitting in published content.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const CVE_REGEX = /CVE-\d{4}-\d{4,}/g;
const CVE_PLACEHOLDER_REGEX =
  /CVE-(?:\d{4}|[A-Z]{4})-(?:[XNY?]{2,}|[A-Z]{5})/gi;

function scan(dir: string) {
  const noCve: string[] = [];
  const withPlaceholder: string[] = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"));
  let total = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf-8");
    const { data, content } = matter(raw);
    if (data.category !== "vulnerabilities") continue;
    total++;
    const bodyCves = content.match(CVE_REGEX) ?? [];
    const placeholders = content.match(CVE_PLACEHOLDER_REGEX) ?? [];
    if (bodyCves.length === 0) noCve.push(f);
    if (placeholders.length > 0)
      withPlaceholder.push(`${f} (${placeholders.join(",")})`);
  }
  return { total, noCve, withPlaceholder };
}

for (const locale of ["en", "zh"]) {
  const r = scan(path.join(process.cwd(), "content", locale, "posts"));
  console.log(`\n[${locale}] vulnerabilities-category: ${r.total} total`);
  console.log(
    `  • ${r.noCve.length} articles with NO CVE in body (${Math.round((100 * r.noCve.length) / Math.max(r.total, 1))}%)`,
  );
  console.log(
    `  • ${r.withPlaceholder.length} articles with PLACEHOLDER CVE (XXXXX/NNNNN)`,
  );
  if (r.withPlaceholder.length) {
    console.log(`  Placeholders:`);
    r.withPlaceholder.slice(0, 10).forEach((x) => console.log(`    - ${x}`));
  }
  if (r.noCve.length) {
    console.log(`  Sample no-CVE files:`);
    r.noCve.slice(0, 5).forEach((x) => console.log(`    - ${x}`));
  }
}
