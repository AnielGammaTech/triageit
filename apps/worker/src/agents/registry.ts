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

/**
 * Agent Registry — maps agent names to their implementations.
 *
 * Each agent gets its own MemoryManager and SkillLoader,
 * sharing the same Supabase client for database access.
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
 * Get agents relevant to a specific ticket classification type.
 */
export function getAgentsForClassification(
  classificationType: string,
): ReadonlyArray<string> {
  const mapping: Record<string, ReadonlyArray<string>> = {
    voip: ["kelly_kapoor"],
    telephony: ["kelly_kapoor"],
    phone: ["kelly_kapoor"],
    network: ["andy_bernard", "stanley_hudson"],
    email: ["phyllis_vance", "dwight_schrute"],
    endpoint: ["andy_bernard", "dwight_schrute"],
    cloud: ["stanley_hudson", "meredith_palmer"],
    backup: ["meredith_palmer"],
    security: ["angela_martin", "jim_halpert"],
    identity: ["jim_halpert"],
    application: ["dwight_schrute"],
    infrastructure: ["andy_bernard", "stanley_hudson"],
    onboarding: ["jim_halpert", "dwight_schrute"],
    billing: ["dwight_schrute"],
    other: ["dwight_schrute"],
  };

  return mapping[classificationType] ?? ["dwight_schrute"];
}
