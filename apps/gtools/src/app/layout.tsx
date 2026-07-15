import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
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
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
