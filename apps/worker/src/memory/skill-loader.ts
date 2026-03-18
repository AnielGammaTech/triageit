import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSkill, SkillType } from "@triageit/shared";

/**
 * SkillLoader — Loads uploaded skills for an agent to inject into prompts.
 *
 * Skills are structured knowledge uploaded by admins:
 * - instruction: General guidance for how the agent should behave
 * - procedure: Step-by-step procedures for specific scenarios
 * - runbook: Operational runbooks with detailed troubleshooting steps
 * - template: Response templates for common ticket types
 * - context: Background context about the customer environment
 */
export class SkillLoader {
  private readonly supabase: SupabaseClient;
  private cache: Map<string, ReadonlyArray<AgentSkill>> = new Map();
  private cacheTimestamp: Map<string, number> = new Map();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Load all active skills for an agent.
   * Results are cached for 5 minutes to avoid repeated DB calls during triage.
   */
  async loadSkills(agentName: string): Promise<ReadonlyArray<AgentSkill>> {
    const now = Date.now();
    const cached = this.cache.get(agentName);
    const timestamp = this.cacheTimestamp.get(agentName) ?? 0;

    if (cached && now - timestamp < SkillLoader.CACHE_TTL_MS) {
      return cached;
    }

    const { data, error } = await this.supabase
      .from("agent_skills")
      .select("*")
      .eq("agent_name", agentName)
      .eq("is_active", true)
      .order("skill_type", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error(
        `[SKILLS] Failed to load skills for ${agentName}:`,
        error.message,
      );
      return cached ?? [];
    }

    const skills = (data ?? []) as ReadonlyArray<AgentSkill>;
    this.cache.set(agentName, skills);
    this.cacheTimestamp.set(agentName, now);

    return skills;
  }

  /**
   * Load skills filtered by type.
   */
  async loadSkillsByType(
    agentName: string,
    skillType: SkillType,
  ): Promise<ReadonlyArray<AgentSkill>> {
    const allSkills = await this.loadSkills(agentName);
    return allSkills.filter((s) => s.skill_type === skillType);
  }

  /**
   * Format skills into a prompt-injectable string.
   * Organized by skill type with clear section headers.
   */
  async formatForPrompt(agentName: string): Promise<string> {
    const skills = await this.loadSkills(agentName);

    if (skills.length === 0) return "";

    const grouped = new Map<string, ReadonlyArray<AgentSkill>>();
    for (const skill of skills) {
      const existing = grouped.get(skill.skill_type) ?? [];
      grouped.set(skill.skill_type, [...existing, skill]);
    }

    const sections: string[] = [];

    const typeLabels: Record<string, string> = {
      instruction: "Instructions",
      procedure: "Procedures",
      runbook: "Runbooks",
      template: "Response Templates",
      context: "Environment Context",
    };

    for (const [type, typeSkills] of grouped) {
      const label = typeLabels[type] ?? type;
      const items = typeSkills
        .map((s) => `### ${s.title}\n${s.content}`)
        .join("\n\n");
      sections.push(`## ${label}\n\n${items}`);
    }

    return `\n---\n# Agent Skills & Knowledge\n\n${sections.join("\n\n")}\n---\n`;
  }

  /**
   * Clear the cache for an agent (e.g., after skill upload).
   */
  clearCache(agentName?: string): void {
    if (agentName) {
      this.cache.delete(agentName);
      this.cacheTimestamp.delete(agentName);
    } else {
      this.cache.clear();
      this.cacheTimestamp.clear();
    }
  }
}
