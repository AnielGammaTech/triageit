import { notFound } from "next/navigation";
import { BrowseSops } from "@/components/BrowseSops";
import { categoryFromSlug } from "@/lib/categories";
import { listPublishedSops } from "@/lib/sop-store";

export const dynamic = "force-dynamic";

interface CategoryPageProps {
  readonly params: Promise<{ readonly categorySlug: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps) {
  const { categorySlug } = await params;
  const category = categoryFromSlug(categorySlug);
  return {
    title: category ? `${category} SOPs` : "SOP Category",
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { categorySlug } = await params;
  const category = categoryFromSlug(categorySlug);
  if (!category) notFound();

  const sops = await listPublishedSops();
  return <BrowseSops sops={sops} initialCategory={category} />;
}
