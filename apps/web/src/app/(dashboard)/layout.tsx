import { Sidebar } from "@/components/dashboard/sidebar";
import { FloatingAdminland } from "@/components/admin/floating-adminland";
import { getAuthenticatedPageUser } from "@/lib/auth/page-role";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedPageUser();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#09090b" }}>
      <Sidebar userEmail={user.email} userRole={user.role} />
      <main className="pt-14">
        <div className="mx-auto w-full max-w-[1680px] p-3 sm:p-4 lg:p-5">{children}</div>
      </main>
      {user.role === "admin" && <FloatingAdminland />}
    </div>
  );
}
