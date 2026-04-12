import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
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
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
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
        url: "/images/defaults/og-default.svg",
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
    images: ["/images/defaults/og-default.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster richColors position="top-right" closeButton duration={5000} />
      </body>
    </html>
  );
}
