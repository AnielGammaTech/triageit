import { AiSettingsPanel } from "@/components/ai-settings-panel";
import { PageHeading } from "@/components/page-heading";
import { getAiConfiguration, testAiConnection } from "@/lib/ai-status";
import { hasScreenItDatabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const initial = {
    configuration: getAiConfiguration(),
    connection: await testAiConnection(),
    database: hasScreenItDatabase() ? "connected" as const : "demo" as const,
  };
  return <div className="screenit-rise space-y-5"><PageHeading eyebrow="ScreenIT administration" title="AI & system settings" description="See exactly what powers interviews, resume analysis, recruiter reports, and candidate storage." /><AiSettingsPanel initial={initial} /></div>;
}
