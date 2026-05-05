import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SopDocumentView } from "@/components/SopDocumentView";
import { purposeDescription } from "@/lib/format";
import { getSop, resolveSopSlug } from "@/lib/sop-store";

export const dynamic = "force-dynamic";

interface SopPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({ params }: SopPageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveSopSlug(slug);
  const sop = resolved ? await getSop(resolved) : undefined;
  if (!sop) return { title: "SOP not found" };

  return {
    title: sop.title,
    description: purposeDescription(sop.content_html),
    alternates: {
      canonical: `/sop/${sop.slug}`,
    },
    openGraph: {
      title: sop.title,
      description: purposeDescription(sop.content_html),
      type: "article",
    },
  };
}

export default async function SopPage({ params }: SopPageProps) {
  const { slug } = await params;
  const resolved = await resolveSopSlug(slug);
  if (!resolved) notFound();
  if (resolved !== slug) redirect(`/sop/${resolved}`);

  const sop = await getSop(resolved);
  if (!sop || sop.status !== "Approved") notFound();

  return (
    <main className="document-page">
      <SopDocumentView sop={sop} />
    </main>
  );
}
