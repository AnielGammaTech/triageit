import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-archivo",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-mono-tv",
});

export const metadata: Metadata = {
  title: "TriageIT Command",
  description: "Live operations wallboard",
};

export default function TvLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`${archivo.variable} ${mono.variable}`} style={{ fontFamily: "var(--font-archivo), sans-serif" }}>
      {children}
    </div>
  );
}
