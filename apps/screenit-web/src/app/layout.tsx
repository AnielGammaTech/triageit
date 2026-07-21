import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ScreenIT", template: "%s · ScreenIT" },
  description: "Structured, evidence-based candidate interview screening.",
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
