import type { Metadata } from "next";
import { Inter, Sora, Unbounded } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-unbounded",
});
// Wordmark treatment only (see docs/brand/gtools-logo-standard.md) — weight
// 700 (Bold) is the only weight the two-tone tool wordmark ever uses.
// Aliased to the semantic `--font-wordmark` var in globals.css, same
// two-tier pattern as --font-display/--font-body over --font-unbounded/
// --font-inter.
const sora = Sora({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-sora",
});

export const metadata: Metadata = {
  title: "GTools — The software we built to run our MSP",
  description:
    "Eleven products engineered by Gamma Tech Services to triage tickets, stop attacks, reconcile billing, and keep clients informed.",
  metadataBase: new URL("https://gtools.io"),
  openGraph: {
    title: "GTools — The software we built to run our MSP",
    description:
      "Eleven products engineered by Gamma Tech Services to triage tickets, stop attacks, reconcile billing, and keep clients informed.",
    url: "https://gtools.io",
    siteName: "GTools",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${unbounded.variable} ${sora.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
