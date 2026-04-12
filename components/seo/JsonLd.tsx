const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";
const PUBLISHER_NAME = "ZCyberNews";
const PUBLISHER_LOGO = `${SITE_URL}/opengraph-image`;

// ─── NewsArticle ──────────────────────────────────────────────────────────────

interface NewsArticleJsonLdProps {
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  url: string;
  image?: string;
  keywords?: string[];
}

export function NewsArticleJsonLd({
  headline,
  description,
  datePublished,
  dateModified,
  authorName,
  url,
  image,
  keywords = [],
}: NewsArticleJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    description,
    datePublished: datePublished.includes("T")
      ? datePublished
      : `${datePublished}T00:00:00Z`,
    dateModified: (dateModified ?? datePublished).includes("T")
      ? (dateModified ?? datePublished)
      : `${dateModified ?? datePublished}T00:00:00Z`,
    author:
      authorName === "AI-generated" || authorName === "ZCyberNews"
        ? { "@type": "Organization", name: "ZCyberNews" }
        : { "@type": "Person", name: authorName },
    publisher: {
      "@type": "Organization",
      name: PUBLISHER_NAME,
      logo: { "@type": "ImageObject", url: PUBLISHER_LOGO },
    },
    url,
    ...(image && {
      image: { "@type": "ImageObject", url: image, width: 1200, height: 630 },
    }),
    ...(keywords.length > 0 && { keywords: keywords.join(", ") }),
    inLanguage: url.includes("/zh/") ? "zh-Hans" : "en",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

// ─── Organization + WebSite (homepage) ───────────────────────────────────────

export function HomeJsonLd({ locale }: { locale: string }) {
  const isZh = locale === "zh";
  const pageUrl = `${SITE_URL}/${locale}`;

  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PUBLISHER_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: PUBLISHER_LOGO },
    description: isZh
      ? "深度威胁分析、漏洞研究与安全资讯，为防御者服务。"
      : "In-depth threat analysis, vulnerability research, and security news for defenders.",
    sameAs: [],
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: PUBLISHER_NAME,
    url: SITE_URL,
    inLanguage: isZh ? "zh-Hans" : "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/${locale}/articles?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: isZh
      ? "ZCyberNews — 网络安全与科技情报"
      : "ZCyberNews — Cybersecurity & Tech Intelligence",
    url: pageUrl,
    description: isZh
      ? "深度威胁分析、漏洞研究与安全资讯，为防御者服务。"
      : "In-depth threat analysis, vulnerability research, and security news for defenders.",
    publisher: { "@type": "Organization", name: PUBLISHER_NAME },
    inLanguage: isZh ? "zh-Hans" : "en",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webpage) }}
      />
    </>
  );
}

// ─── BreadcrumbList ───────────────────────────────────────────────────────────

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
