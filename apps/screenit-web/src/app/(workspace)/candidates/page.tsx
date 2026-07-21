import { PageHeading } from "@/components/page-heading";
import { CandidatesWorkspace } from "@/components/candidates-workspace";
import { getWorkspaceSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const workspace = await getWorkspaceSnapshot();
  return <div className="screenit-rise space-y-5"><PageHeading eyebrow="Candidate pipeline" title="Candidates" description="Add resumes, schedule structured screening, and review evidence in one queue." /><CandidatesWorkspace initialCandidates={workspace.candidates} positions={workspace.positions} /></div>;
}
