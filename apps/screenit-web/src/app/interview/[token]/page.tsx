import { notFound } from "next/navigation";
import { InterviewRoom } from "@/components/interview-room";
import { getInterviewByToken } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getInterviewByToken(token);
  if (!result) notFound();
  return <InterviewRoom candidate={result.candidate} position={result.position} />;
}
