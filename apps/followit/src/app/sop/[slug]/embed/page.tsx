import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SopDocumentView } from "@/components/SopDocumentView";
import { purposeDescription } from "@/lib/format";
import { getSop, resolveSopSlug } from "@/lib/sop-store";

export const dynamic = "force-dynamic";

interface EmbedPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: EmbedPageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveSopSlug(slug);
  const sop = resolved ? await getSop(resolved) : undefined;
  return {
    title: sop ? `${sop.title} Embed` : "SOP Embed",
    description: sop ? purposeDescription(sop.content_html) : undefined,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function SopEmbedPage({ params }: EmbedPageProps) {
  const { slug } = await params;
  const resolved = await resolveSopSlug(slug);
  if (!resolved) notFound();
  if (resolved !== slug) redirect(`/sop/${resolved}/embed`);

  const sop = await getSop(resolved);
  if (!sop || sop.status !== "Approved") notFound();

  return (
    <main className="embed-page">
      <SopDocumentView sop={sop} chrome="embed" />
    </main>
  );
}
