import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TriageIT - AI Ticket Triage",
  description: "AI-powered MSP ticket triage system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
