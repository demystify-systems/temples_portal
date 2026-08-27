import type { Metadata } from "next";
import { Marcellus, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { SITE_NAME, SITE_DESC } from "@/lib/sites";
import "./globals.css";
import { SITE_URL } from "@/lib/site-url.mjs";

const display = Marcellus({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const ui = Hanken_Grotesk({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-ui" });
const mono = IBM_Plex_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESC,
  metadataBase: new URL(SITE_URL),
  // "./" resolves per-route against metadataBase, so every page declares its own
  // canonical. Without it the site served identical 200s on four hosts with no
  // stated preference, leaving search engines to pick one and split authority
  // across the rest. next.config.mjs enforces what this declares.
  alternates: { canonical: "./" },
  openGraph: { title: SITE_NAME, description: SITE_DESC, type: "website", siteName: SITE_NAME, url: SITE_URL },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESC },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
