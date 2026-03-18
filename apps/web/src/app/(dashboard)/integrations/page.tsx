import { redirect } from "next/navigation";

export default function IntegrationsPage() {
  redirect("/adminland?section=integrations");
}
