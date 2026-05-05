import { BrowseSops } from "@/components/BrowseSops";
import { listPublishedSops } from "@/lib/sop-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sops = await listPublishedSops();
  return <BrowseSops sops={sops} />;
}
