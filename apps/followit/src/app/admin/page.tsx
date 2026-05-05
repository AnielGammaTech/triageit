import { redirect } from "next/navigation";
import { AdminWorkspace } from "@/components/AdminWorkspace";
import { isAdminSession } from "@/lib/admin-auth";
import { listSops } from "@/lib/sop-store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin",
};

export default async function AdminPage() {
  if (!(await isAdminSession())) redirect("/admin/login");

  const sops = await listSops();
  return <AdminWorkspace initialSops={sops} />;
}
