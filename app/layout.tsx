import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ZCyberNews",
    template: "%s | ZCyberNews",
  },
  description:
    "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com",
  ),
  keywords: [
    "cybersecurity",
    "threat intelligence",
    "malware analysis",
    "vulnerability research",
    "security news",
    "CVE",
    "ransomware",
    "APT",
  ],
  authors: [{ name: "ZCyberNews" }],
  creator: "ZCyberNews",
  openGraph: {
    type: "website",
    siteName: "ZCyberNews",
    title: "ZCyberNews",
    description:
      "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "ZCyberNews",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZCyberNews",
    description:
      "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
    images: ["/opengraph-image"],
  },
  alternates: {
    types: {
      "application/rss+xml": "/api/feed",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale?: string }>;
}>) {
  const { locale } = await params;
  const lang = locale === "zh" ? "zh-Hans" : "en";

  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" closeButton duration={5000} />
        {/* Google AdSense */}
        {process.env.NEXT_PUBLIC_ADSENSE_ID && (
          <Script
            async
            crossOrigin="anonymous"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_ADSENSE_ID}`}
            strategy="afterInteractive"
          />
        )}
        {/* Plausible Analytics — privacy-friendly, no cookies */}
        {process.env.PLAUSIBLE_DOMAIN && (
          <Script
            defer
            data-domain={process.env.PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
