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
  openGraph: { title: SITE_NAME, description: SITE_DESC, type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
