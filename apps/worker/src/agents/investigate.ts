import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HuduConfig,
  DattoConfig,
  JumpCloudConfig,
} from "@triageit/shared";
import { HuduClient } from "../integrations/hudu/client.js";
import { DattoClient } from "../integrations/datto/client.js";
import { JumpCloudClient } from "../integrations/jumpcloud/client.js";

/**
 * Run a lightweight investigation using a specialist worker's integration.
 * Unlike a full triage, this just queries the integration and returns raw data
 * for Michael to reason about in chat.
 */
export async function investigateWithWorker(
  supabase: SupabaseClient,
  worker: string,
  clientName: string,
  question: string,
): Promise<string> {
  const handler = WORKER_HANDLERS[worker];
  if (!handler) {
    return `Worker "${worker}" doesn't have an investigation handler yet. Available: ${Object.keys(WORKER_HANDLERS).join(", ")}`;
  }

  return handler(supabase, clientName, question);
}

type InvestigationHandler = (
  supabase: SupabaseClient,
  clientName: string,
  question: string,
) => Promise<string>;

// ── Integration helpers ──────────────────────────────────────────────

async function getConfig<T>(
  supabase: SupabaseClient,
  service: string,
): Promise<T | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", service)
    .eq("is_active", true)
    .single();

  return data ? (data.config as T) : null;
}

// ── Dwight: Hudu ─────────────────────────────────────────────────────

async function investigateDwight(
  supabase: SupabaseClient,
  clientName: string,
  question: string,
): Promise<string> {
  const config = await getConfig<HuduConfig>(supabase, "hudu");
  if (!config) return "Hudu integration is not configured.";

  const hudu = new HuduClient(config);

  // Find the company
  const companies = await hudu.searchCompanies(clientName);
  if (!companies || companies.length === 0) {
    return `No company matching "${clientName}" found in Hudu.`;
  }

  const company = companies[0];
  const companyId = company.id;
  let result = `**Hudu Company:** ${company.name} (ID: ${companyId})\n\n`;

  // Pull assets, articles, passwords overview
  const [assets, articles, layouts] = await Promise.all([
    hudu.getAssets({ company_id: companyId }).catch(() => []),
    hudu.getArticles({ company_id: companyId }).catch(() => []),
    hudu.getAssetLayouts().catch(() => []),
  ]);

  const layoutMap = new Map(layouts.map((l: { id: number; name: string }) => [l.id, l.name]));

  if (assets.length > 0) {
    result += `**Assets (${assets.length}):**\n`;
    // Group by layout
    const byLayout: Record<string, string[]> = {};
    for (const a of assets) {
      const layoutName = (a.asset_layout_id != null ? layoutMap.get(a.asset_layout_id) : undefined) ?? "Other";
      const list = byLayout[layoutName] ?? [];
      list.push(a.name);
      byLayout[layoutName] = list;
    }
    for (const [layout, names] of Object.entries(byLayout)) {
      result += `- **${layout}**: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ` (+${names.length - 10} more)` : ""}\n`;
    }
    result += "\n";
  }

  if (articles.length > 0) {
    result += `**Knowledge Base Articles (${articles.length}):**\n`;
    for (const a of articles.slice(0, 10)) {
      result += `- ${a.name}\n`;
    }
    result += "\n";
  }

  // If question mentions specific keywords, try to find relevant assets
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("password") || lowerQ.includes("credential")) {
    const passwords = await hudu.getPasswords({ company_id: companyId }).catch(() => []);
    result += `**Passwords:** ${passwords.length} stored entries\n`;
    for (const p of passwords.slice(0, 10)) {
      result += `- ${p.name}\n`;
    }
  }

  return result;
}

// ── Andy: Datto RMM ──────────────────────────────────────────────────

async function investigateAndy(
  supabase: SupabaseClient,
  clientName: string,
  _question: string,
): Promise<string> {
  const config = await getConfig<DattoConfig>(supabase, "datto");
  if (!config) return "Datto RMM integration is not configured.";

  const datto = new DattoClient(config);

  // Find site by client name
  const sites = await datto.getSites();
  const site = sites.find((s) =>
    s.name.toLowerCase().includes(clientName.toLowerCase()) ||
    clientName.toLowerCase().includes(s.name.toLowerCase()),
  );

  if (!site) {
    return `No Datto site matching "${clientName}" found. Available sites: ${sites.slice(0, 10).map((s) => s.name).join(", ")}`;
  }

  let result = `**Datto Site:** ${site.name} (ID: ${site.id})\n\n`;

  // Get devices for this site
  const devices = await datto.getDevices(site.id);
  result += `**Devices (${devices.length}):**\n`;
  for (const d of devices.slice(0, 20)) {
    const status = d.online ? "Online" : "OFFLINE";
    result += `- **${d.hostname ?? "Unknown"}** (${d.operatingSystem ?? "?"}) — ${status}`;
    if (d.lastSeen) result += ` | Last seen: ${new Date(d.lastSeen).toLocaleDateString()}`;
    if (d.patchStatus?.patchesMissing) result += ` | Missing patches: ${d.patchStatus.patchesMissing}`;
    result += "\n";
  }

  // Get recent alerts
  const alerts = await datto.getOpenAlerts(site.id).catch(() => []);
  if (alerts.length > 0) {
    result += `\n**Recent Alerts (${alerts.length}):**\n`;
    for (const a of alerts.slice(0, 10)) {
      result += `- [${a.priority ?? "?"}] ${a.alertMessage ?? a.alertType ?? "Unknown alert"} — ${a.timestamp ? new Date(a.timestamp).toLocaleDateString() : "?"}\n`;
    }
  }

  return result;
}

// ── Jim: JumpCloud ───────────────────────────────────────────────────

async function investigateJim(
  supabase: SupabaseClient,
  clientName: string,
  question: string,
): Promise<string> {
  const config = await getConfig<JumpCloudConfig>(supabase, "jumpcloud");
  if (!config) return "JumpCloud integration is not configured.";

  const jc = new JumpCloudClient(config);

  let result = `**JumpCloud Investigation for "${clientName}":**\n\n`;

  // If question mentions a specific user, search for them
  const emailMatch = question.match(/[\w.+-]+@[\w.-]+/);
  const nameMatch = question.match(/(?:user|for|about)\s+(\w+(?:\s+\w+)?)/i);

  if (emailMatch) {
    const users = await jc.searchUsers(emailMatch[0]);
    if (users.length > 0) {
      result += `**User Found:**\n`;
      for (const u of users) {
        result += `- **${u.displayname ?? u.username}** (${u.email}) — ${u.activated ? "Active" : "INACTIVE"}`;
        if (u.mfa) result += ` | MFA: ${JSON.stringify(u.mfa)}`;
        result += "\n";
      }
    } else {
      result += `No user found for "${emailMatch[0]}"\n`;
    }
  } else if (nameMatch) {
    const users = await jc.searchUsers(nameMatch[1]);
    result += `**Users matching "${nameMatch[1]}":**\n`;
    for (const u of users.slice(0, 10)) {
      result += `- **${u.displayname ?? u.username}** (${u.email}) — ${u.activated ? "Active" : "INACTIVE"}\n`;
    }
  } else {
    // General overview
    const users = await jc.getUsers();
    result += `**Total Users:** ${users.length}\n`;
    const active = users.filter((u) => u.activated);
    const inactive = users.filter((u) => !u.activated);
    result += `Active: ${active.length} | Inactive: ${inactive.length}\n`;
  }

  return result;
}

// ── Stub handlers for integrations not yet live ──────────────────────

function makeStubHandler(name: string, integration: string): InvestigationHandler {
  return async (supabase, _clientName, _question) => {
    const config = await getConfig<Record<string, unknown>>(supabase, integration);
    if (!config) return `${name} integration (${integration}) is not configured.`;
    return `${name} integration is configured but investigation isn't implemented yet. The data will be available during full triage runs.`;
  };
}

// ── Worker handler map ───────────────────────────────────────────────

const WORKER_HANDLERS: Record<string, InvestigationHandler> = {
  "dwight-schrute": investigateDwight,
  "andy-bernard": investigateAndy,
  "jim-halpert": investigateJim,
  "kelly-kapoor": makeStubHandler("Kelly (3CX)", "threecx"),
  "stanley-hudson": makeStubHandler("Stanley (Vultr)", "vultr"),
  "phyllis-vance": makeStubHandler("Phyllis (MX Toolbox)", "mxtoolbox"),
  "meredith-palmer": makeStubHandler("Meredith (Spanning)", "spanning"),
  "oscar-martinez": makeStubHandler("Oscar (Cove/Unitrends)", "cove"),
  "darryl-philbin": makeStubHandler("Darryl (CIPP)", "cipp"),
  "creed-bratton": makeStubHandler("Creed (UniFi)", "unifi"),
};
