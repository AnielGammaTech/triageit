import { createClient } from "@/lib/supabase/server";
import { IntegrationGrid } from "@/components/integrations/integration-grid";
import { INTEGRATION_DEFINITIONS } from "@triageit/shared";

export default async function IntegrationsPage() {
  const supabase = await createClient();

  const { data: integrations } = await supabase
    .from("integrations")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Integrations</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Configure your MSP tool connections. API credentials are encrypted at
          rest.
        </p>
      </div>
      <IntegrationGrid
        definitions={INTEGRATION_DEFINITIONS}
        integrations={integrations ?? []}
      />
    </div>
  );
}
