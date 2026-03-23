import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENTS, type AgentDefinition } from "@triageit/shared";
import { BaseAgent } from "./base-agent.js";
import { MemoryManager } from "../memory/memory-manager.js";
import { SkillLoader } from "../memory/skill-loader.js";
import { DwightSchruteAgent } from "./workers/dwight-schrute.js";
import { JimHalpertAgent } from "./workers/jim-halpert.js";
import { AndyBernardAgent } from "./workers/andy-bernard.js";
import { StanleyHudsonAgent } from "./workers/stanley-hudson.js";
import { PhyllisVanceAgent } from "./workers/phyllis-vance.js";
import { AngelaMartin } from "./workers/angela-martin.js";
import { MeredithPalmerAgent } from "./workers/meredith-palmer.js";
import { KellyKapoorAgent } from "./workers/kelly-kapoor.js";
import { OscarMartinezAgent } from "./workers/oscar-martinez.js";
import { DarrylPhilbinAgent } from "./workers/darryl-philbin.js";
import { CreedBrattonAgent } from "./workers/creed-bratton.js";

/**
 * Agent Registry — maps agent names to their implementations.
 *
 * Each agent gets its own MemoryManager and SkillLoader,
 * sharing the same Supabase client for database access.
 *
 * Integration-gated agents (jim_halpert, andy_bernard, etc.) only run
 * when their integration is active AND has a mapping for the ticket's customer.
 */

type AgentConstructor = new (
  definition: AgentDefinition,
  supabase: SupabaseClient,
  memoryManager: MemoryManager,
  skillLoader: SkillLoader,
) => BaseAgent;

const AGENT_IMPLEMENTATIONS: Record<string, AgentConstructor> = {
  dwight_schrute: DwightSchruteAgent,
  jim_halpert: JimHalpertAgent,
  andy_bernard: AndyBernardAgent,
  stanley_hudson: StanleyHudsonAgent,
  phyllis_vance: PhyllisVanceAgent,
  angela_martin: AngelaMartin,
  meredith_palmer: MeredithPalmerAgent,
  kelly_kapoor: KellyKapoorAgent,
  oscar_martinez: OscarMartinezAgent,
  darryl_philbin: DarrylPhilbinAgent,
  creed_bratton: CreedBrattonAgent,
};

/**
 * Agents that require a specific integration to be active AND
 * have a customer mapping for the ticket's client.
 */
const AGENT_REQUIRED_INTEGRATION: Record<string, string | ReadonlyArray<string>> = {
  jim_halpert: "jumpcloud",
  andy_bernard: "datto",
  kelly_kapoor: "threecx",
  meredith_palmer: "spanning",
  stanley_hudson: "vultr",
  oscar_martinez: ["cove", "unitrends"],
  darryl_philbin: "cipp",
  creed_bratton: "unifi",
};

/**
 * Create an agent instance by name, with memory and skills wired up.
 */
export function createAgent(
  agentName: string,
  supabase: SupabaseClient,
): BaseAgent | null {
  const definition = AGENTS.find((a) => a.name === agentName);
  if (!definition) return null;

  const Constructor = AGENT_IMPLEMENTATIONS[agentName];
  if (!Constructor) return null;

  const memoryManager = new MemoryManager(supabase);
  const skillLoader = new SkillLoader(supabase);

  return new Constructor(definition, supabase, memoryManager, skillLoader);
}

/**
 * Get all agents that have implementations ready.
 */
export function getAvailableAgents(): ReadonlyArray<AgentDefinition> {
  return AGENTS.filter((a) => a.name in AGENT_IMPLEMENTATIONS);
}

/**
 * Check if an integration is active and has a customer mapping
 * for the given client name.
 */
async function isIntegrationMappedForCustomer(
  supabase: SupabaseClient,
  service: string | ReadonlyArray<string>,
  customerName: string | null,
): Promise<boolean> {
  const services = Array.isArray(service) ? service : [service];

  // Check if ANY of the listed services is active
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, is_active")
    .in("service", services)
    .eq("is_active", true);

  if (!integrations || integrations.length === 0) return false;

  // If no customer name, integration is active but we can't check mapping
  // Let the agent try anyway (it will handle missing data gracefully)
  if (!customerName) return true;

  const integrationIds = integrations.map((i) => i.id);

  // Try exact case-insensitive match first (fast path)
  const { data: exactMapping } = await supabase
    .from("integration_mappings")
    .select("id")
    .in("integration_id", integrationIds)
    .ilike("customer_name", customerName)
    .limit(1)
    .maybeSingle();

  if (exactMapping) return true;

  // Fuzzy fallback — fetch all mappings for these integrations and normalize
  const { data: allMappings } = await supabase
    .from("integration_mappings")
    .select("customer_name")
    .in("integration_id", integrationIds);

  if (!allMappings || allMappings.length === 0) return false;

  const ticketNorm = normalizeName(customerName);
  return allMappings.some((m) => {
    const mappedNorm = normalizeName(m.customer_name);
    if (!mappedNorm || !ticketNorm) return false;
    // Normalized exact
    if (mappedNorm === ticketNorm) return true;
    // Contains (one name is a substring of the other)
    if (mappedNorm.includes(ticketNorm) || ticketNorm.includes(mappedNorm)) {
      const ratio = Math.min(mappedNorm.length, ticketNorm.length) / Math.max(mappedNorm.length, ticketNorm.length);
      return ratio >= 0.5;
    }
    return false;
  });
}

/** Strip suffixes like Inc, LLC, Ltd and normalize whitespace for fuzzy company matching. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(inc|llc|ltd|corp|co|the|company|group|services|solutions|llp|pllc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get agents relevant to a specific ticket classification type,
 * filtered by which integrations are active and mapped for the customer.
 */
export async function getAgentsForClassification(
  classificationType: string,
  supabase: SupabaseClient,
  customerName: string | null,
): Promise<ReadonlyArray<string>> {
  // Dwight (Hudu documentation + Quick Links) is always included — docs are
  // relevant for every ticket type and Quick Links must always appear.
  const mapping: Record<string, ReadonlyArray<string>> = {
    voip: ["kelly_kapoor", "dwight_schrute"],
    telephony: ["kelly_kapoor", "dwight_schrute"],
    phone: ["kelly_kapoor", "dwight_schrute"],
    network: ["andy_bernard", "stanley_hudson", "creed_bratton", "dwight_schrute"],
    email: ["phyllis_vance", "dwight_schrute", "darryl_philbin"],
    endpoint: ["andy_bernard", "dwight_schrute"],
    cloud: ["stanley_hudson", "meredith_palmer", "oscar_martinez", "dwight_schrute"],
    backup: ["meredith_palmer", "oscar_martinez", "dwight_schrute"],
    security: ["angela_martin", "jim_halpert", "phyllis_vance", "darryl_philbin", "dwight_schrute"],
    identity: ["jim_halpert", "darryl_philbin", "dwight_schrute"],
    application: ["dwight_schrute", "andy_bernard"],
    infrastructure: ["andy_bernard", "stanley_hudson", "dwight_schrute"],
    onboarding: ["jim_halpert", "dwight_schrute"],
    billing: ["dwight_schrute"],
    other: ["dwight_schrute"],
  };

  const candidates = mapping[classificationType] ?? ["dwight_schrute"];

  // Filter integration-gated agents by active integration + customer mapping
  const eligibilityChecks = await Promise.all(
    candidates.map(async (agentName) => {
      const requiredService = AGENT_REQUIRED_INTEGRATION[agentName];
      if (!requiredService) {
        // Agent doesn't require a specific integration (dwight, angela)
        return { agentName, eligible: true };
      }
      const eligible = await isIntegrationMappedForCustomer(
        supabase,
        requiredService,
        customerName,
      );
      if (!eligible) {
        console.log(
          `[REGISTRY] Skipping ${agentName} — ${requiredService} not active or not mapped for "${customerName}"`,
        );
      }
      return { agentName, eligible };
    }),
  );

  const eligible = eligibilityChecks
    .filter((c) => c.eligible)
    .map((c) => c.agentName);

  // Always have at least dwight_schrute as fallback
  return eligible.length > 0 ? eligible : ["dwight_schrute"];
}
