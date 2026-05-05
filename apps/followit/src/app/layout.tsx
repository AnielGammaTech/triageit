import type { Metadata } from "next";
import "./globals.css";

function metadataBase(): URL {
  const configured = process.env.FOLLOWIT_PUBLIC_URL ?? "http://localhost:3001";
  try {
    return new URL(configured);
  } catch {
    return new URL("http://localhost:3001");
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: {
    default: "FollowIT - Gamma Tech SOPs",
    template: "%s | FollowIT",
  },
  description: "Gamma Tech Services SOP library for stable Hudu links and polished procedure pages.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
