import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import { getWorkspaceSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const workspace = await getWorkspaceSnapshot();
  return <WorkspaceDashboard initial={workspace} />;
}
