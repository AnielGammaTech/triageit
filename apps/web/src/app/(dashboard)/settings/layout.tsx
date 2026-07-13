import { requirePageRole } from "@/lib/auth/page-role";

export default async function SettingsLayout({ children }: { readonly children: React.ReactNode }) {
  await requirePageRole(["admin"]);
  return children;
}
