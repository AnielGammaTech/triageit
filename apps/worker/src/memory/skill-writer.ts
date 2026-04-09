import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedSkill } from "./skill-extractor.js";

/**
 * SkillWriter — Persists agent-generated skills with deduplication.
 *
 * When an agent produces a <skill> tag, the writer:
 * 1. Checks for an existing skill with a similar title (fuzzy match)
 * 2. If found, updates the existing skill (content merge, bump updated_at)
 * 3. If new, inserts it
 *
 * This prevents skill bloat from agents repeatedly learning the same thing.
 */
export class SkillWriter {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Write a batch of extracted skills for an agent.
   * Deduplicates against existing skills by title similarity.
   */
  async writeSkills(
    agentName: string,
    skills: ReadonlyArray<ExtractedSkill>,
    context: {
      readonly ticketId: string;
      readonly haloId: number;
    },
  ): Promise<number> {
    let written = 0;

    for (const skill of skills) {
      try {
        const didWrite = await this.upsertSkill(agentName, skill, context);
        if (didWrite) written++;
      } catch (error) {
        console.error(
          `[SKILL-WRITER] Failed to write skill "${skill.title}" for ${agentName}:`,
          error,
        );
      }
    }

    if (written > 0) {
      console.log(
        `[SKILL-WRITER] Wrote ${written} skill(s) for ${agentName} from ticket #${context.haloId}`,
      );
    }

    return written;
  }

  /**
   * Upsert a single skill. Returns true if a new skill was created or existing updated.
   */
  private async upsertSkill(
    agentName: string,
    skill: ExtractedSkill,
    context: { readonly ticketId: string; readonly haloId: number },
  ): Promise<boolean> {
    // Check for existing skill with similar title
    const existing = await this.findSimilarSkill(agentName, skill.title);

    if (existing) {
      // Update existing skill — merge content if meaningfully different
      const shouldUpdate = !existing.content.includes(
        skill.content.slice(0, 100),
      );

      if (shouldUpdate) {
        const mergedContent = `${existing.content}\n\n---\n_Updated from ticket #${context.haloId}:_\n${skill.content}`;

        await this.supabase
          .from("agent_skills")
          .update({
            content: mergedContent,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(existing.metadata as Record<string, unknown>),
              times_used:
                ((existing.metadata as Record<string, unknown>)
                  .times_used as number ?? 0) + 1,
              last_updated_from_ticket: context.haloId,
            },
          })
          .eq("id", existing.id);

        console.log(
          `[SKILL-WRITER] Updated existing skill "${existing.title}" for ${agentName}`,
        );
      }

      return shouldUpdate;
    }

    // Insert new skill
    const { error } = await this.supabase.from("agent_skills").insert({
      agent_name: agentName,
      title: skill.title,
      content: skill.content,
      skill_type: skill.skill_type,
      is_active: true,
      metadata: {
        auto_generated: true,
        source_agent: agentName,
        source_ticket: context.ticketId,
        source_halo_id: context.haloId,
        times_used: 0,
      },
    });

    if (error) {
      console.error(
        `[SKILL-WRITER] Insert failed for "${skill.title}":`,
        error.message,
      );
      return false;
    }

    return true;
  }

  /**
   * Find an existing skill with a similar title.
   * Uses case-insensitive ILIKE match with the first 40 chars of the title.
   */
  private async findSimilarSkill(
    agentName: string,
    title: string,
  ): Promise<{
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly metadata: Record<string, unknown>;
  } | null> {
    // Exact match first
    const { data: exact } = await this.supabase
      .from("agent_skills")
      .select("id, title, content, metadata")
      .eq("agent_name", agentName)
      .eq("is_active", true)
      .ilike("title", title)
      .limit(1)
      .maybeSingle();

    if (exact) return exact as {
      readonly id: string;
      readonly title: string;
      readonly content: string;
      readonly metadata: Record<string, unknown>;
    };

    // Fuzzy match — first significant words of title
    const titlePrefix = title.slice(0, 40).replace(/%/g, "");
    const { data: fuzzy } = await this.supabase
      .from("agent_skills")
      .select("id, title, content, metadata")
      .eq("agent_name", agentName)
      .eq("is_active", true)
      .ilike("title", `%${titlePrefix}%`)
      .limit(1)
      .maybeSingle();

    return fuzzy as {
      readonly id: string;
      readonly title: string;
      readonly content: string;
      readonly metadata: Record<string, unknown>;
    } | null;
  }
}
