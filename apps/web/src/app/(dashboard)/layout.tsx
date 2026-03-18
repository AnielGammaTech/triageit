import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { FloatingAdminland } from "@/components/admin/floating-adminland";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#09090b" }}>
      <Sidebar userEmail={user.email ?? ""} />
      <main className="pt-14">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
      <FloatingAdminland />
    </div>
  );
}
