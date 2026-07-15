import type { Metadata } from "next";
import { Inter, Unbounded } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-unbounded",
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
    <html lang="en" className={`${inter.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
