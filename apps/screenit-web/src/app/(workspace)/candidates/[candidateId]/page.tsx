import { notFound } from "next/navigation";
import { CandidateDetail } from "@/components/candidate-detail";
import { getCandidate } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { readonly params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const result = await getCandidate(candidateId);
  if (!result) notFound();
  return <CandidateDetail candidate={result.candidate} position={result.position} report={result.report} />;
}
