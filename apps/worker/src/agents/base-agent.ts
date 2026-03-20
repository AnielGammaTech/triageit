import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDefinition, MemoryMatch } from "@triageit/shared";
import { MemoryManager } from "../memory/memory-manager.js";
import { SkillLoader } from "../memory/skill-loader.js";
import {
  extractRememberTags,
  REMEMBER_INSTRUCTIONS,
} from "../memory/memory-extractor.js";
import type { TriageContext } from "./types.js";

/**
 * BaseAgent — Foundation for all specialist worker agents.
 *
 * Every agent (Office character) extends this class and gets:
 * 1. Skill loading — uploaded knowledge injected into system prompt
 * 2. Memory recall — relevant past resolutions found via embeddings
 * 3. Memory creation — learns from each ticket it processes
 * 4. Structured logging — all actions logged to agent_logs
 */
export interface AgentResult {
  readonly summary: string;
  readonly data: Record<string, unknown>;
  readonly confidence: number;
  readonly memories_used?: number;
}

export abstract class BaseAgent {
  protected readonly definition: AgentDefinition;
  protected readonly supabase: SupabaseClient;
  protected readonly anthropic: Anthropic;
  protected readonly memoryManager: MemoryManager;
  protected readonly skillLoader: SkillLoader;

  constructor(
    definition: AgentDefinition,
    supabase: SupabaseClient,
    memoryManager: MemoryManager,
    skillLoader: SkillLoader,
  ) {
    this.definition = definition;
    this.supabase = supabase;
    this.anthropic = new Anthropic();
    this.memoryManager = memoryManager;
    this.skillLoader = skillLoader;
  }

  /**
   * Main execution entry point for the agent.
   * Handles the full lifecycle: log start → load skills → recall memories →
   * process → create memory → log complete.
   */
  async execute(context: TriageContext): Promise<AgentResult> {
    const startTime = Date.now();

    // Log agent starting
    await this.log(context.ticketId, "started", {
      input: `Processing ticket #${context.haloId}: ${context.summary}`,
    });

    try {
      // 1. Load skills for this agent
      const skillsPrompt = await this.skillLoader.formatForPrompt(
        this.definition.name,
      );

      // 2. Recall agent-specific + shared memories in parallel
      const queryText = `${context.summary} ${context.details ?? ""}`;
      const [agentMemories, sharedMemories] = await Promise.all([
        this.memoryManager.recall(this.definition.name, queryText),
        this.memoryManager.recallShared(queryText),
      ]);

      // Merge and deduplicate by id, agent-specific first
      const allMemories = this.mergeMemories(agentMemories, sharedMemories);
      const memoriesPrompt = this.formatMemoriesForPrompt(allMemories);

      // 3. Build the full system prompt (now includes <remember> instructions)
      const systemPrompt = this.buildSystemPrompt(skillsPrompt, memoriesPrompt);

      // 4. Execute the agent's specific logic
      const result = await this.process(context, systemPrompt, allMemories);

      // 5. Extract <remember> tags from agent output and store as memories
      await this.extractAndStoreMemories(context, result);

      // 6. Create a memory from this resolution
      await this.createResolutionMemory(context, result);

      // 7. Log completion
      const duration = Date.now() - startTime;
      await this.log(context.ticketId, "completed", {
        output: result.summary,
        duration,
      });

      return { ...result, memories_used: allMemories.length };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await this.log(context.ticketId, "error", {
        error: message,
        duration,
      });
      throw error;
    }
  }

  /**
   * Agent-specific processing logic. Subclasses implement this.
   */
  protected abstract process(
    context: TriageContext,
    systemPrompt: string,
    memories: ReadonlyArray<MemoryMatch>,
  ): Promise<AgentResult>;

  /**
   * Build the full system prompt with character, skills, and memories.
   */
  protected buildSystemPrompt(
    skillsPrompt: string,
    memoriesPrompt: string,
  ): string {
    return [
      `You are ${this.definition.character}, the ${this.definition.specialty} at Dunder Mifflin IT Triage.`,
      "",
      `Your role: ${this.definition.description}`,
      "",
      this.getAgentInstructions(),
      skillsPrompt,
      memoriesPrompt,
      "",
      REMEMBER_INSTRUCTIONS,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Agent-specific instructions. Subclasses can override.
   */
  protected abstract getAgentInstructions(): string;

  /**
   * Merge agent-specific and shared memories, deduplicating by id.
   * Agent-specific memories take priority (appear first).
   */
  private mergeMemories(
    agentMemories: ReadonlyArray<MemoryMatch>,
    sharedMemories: ReadonlyArray<MemoryMatch>,
  ): ReadonlyArray<MemoryMatch> {
    const seenIds = new Set(agentMemories.map((m) => m.id));
    const uniqueShared = sharedMemories.filter((m) => !seenIds.has(m.id));
    return [...agentMemories, ...uniqueShared];
  }

  /**
   * Extract <remember> tags from agent output and store as explicit memories.
   * These are high-signal memories the agent flagged as worth remembering.
   */
  private async extractAndStoreMemories(
    context: TriageContext,
    result: AgentResult,
  ): Promise<void> {
    // Check both summary and stringified data for <remember> tags
    const textToScan = [
      result.summary,
      typeof result.data === "object" ? JSON.stringify(result.data) : "",
    ].join("\n");

    const extracted = extractRememberTags(textToScan);
    if (extracted.length === 0) return;

    console.log(
      `[${this.definition.name}] Extracted ${extracted.length} <remember> tag(s) from ticket #${context.haloId}`,
    );

    for (const mem of extracted) {
      try {
        // Determine if this is agent-specific or shared company context
        const isCompanyWide =
          mem.content.toLowerCase().includes("always") ||
          mem.content.toLowerCase().includes("company") ||
          mem.content.toLowerCase().includes("all clients") ||
          mem.memory_type === "pattern";

        if (isCompanyWide) {
          await this.memoryManager.createSharedMemory({
            ticket_id: context.ticketId,
            content: mem.content,
            summary: mem.content.slice(0, 200),
            memory_type: mem.memory_type,
            confidence: mem.confidence,
            metadata: {
              source_agent: this.definition.name,
              halo_id: context.haloId,
              client_name: context.clientName,
            },
          });
        } else {
          await this.memoryManager.createMemory({
            agent_name: this.definition.name,
            ticket_id: context.ticketId,
            content: mem.content,
            summary: mem.content.slice(0, 200),
            memory_type: mem.memory_type,
            confidence: mem.confidence,
            metadata: {
              halo_id: context.haloId,
              client_name: context.clientName,
              extracted_from: "remember_tag",
            },
          });
        }
      } catch (error) {
        console.error(
          `[${this.definition.name}] Failed to store extracted memory:`,
          error,
        );
      }
    }
  }

  /**
   * Format recalled memories into a prompt section.
   */
  private formatMemoriesForPrompt(
    memories: ReadonlyArray<MemoryMatch>,
  ): string {
    if (memories.length === 0) return "";

    const items = memories
      .map(
        (m, i) =>
          `${i + 1}. [${m.memory_type}] ${m.summary} (confidence: ${(m.confidence * 100).toFixed(0)}%, relevance: ${(m.similarity * 100).toFixed(0)}%)`,
      )
      .join("\n");

    return `\n---\n# Relevant Past Experiences\nYou've handled similar tickets before. Use these memories to inform your analysis:\n\n${items}\n---\n`;
  }

  /**
   * Create a memory from this ticket resolution for future reference.
   */
  private async createResolutionMemory(
    context: TriageContext,
    result: AgentResult,
  ): Promise<void> {
    try {
      const content = [
        `Ticket #${context.haloId}: ${context.summary}`,
        context.details ? `Details: ${context.details}` : "",
        context.clientName ? `Client: ${context.clientName}` : "",
        "",
        `Agent Analysis: ${result.summary}`,
        "",
        `Result: ${JSON.stringify(result.data)}`,
      ]
        .filter(Boolean)
        .join("\n");

      await this.memoryManager.createMemory({
        agent_name: this.definition.name,
        ticket_id: context.ticketId,
        content,
        summary: `Ticket #${context.haloId}: ${result.summary}`,
        memory_type: "resolution",
        confidence: result.confidence,
        metadata: {
          halo_id: context.haloId,
          client_name: context.clientName,
        },
      });
    } catch (error) {
      // Don't fail triage if memory creation fails
      console.error(
        `[${this.definition.name}] Failed to create resolution memory:`,
        error,
      );
    }
  }

  /**
   * Build a text section with image descriptions from the ticket context.
   * Call this in specialist agents to include visual content in text-only messages.
   */
  protected formatImageDescriptions(context: TriageContext): string {
    if (!context.imageDescriptions) return "";
    return [
      "",
      "---",
      "## Screenshots & Images from Ticket",
      "The following text was extracted from images/screenshots attached to this ticket:",
      "",
      context.imageDescriptions,
      "---",
    ].join("\n");
  }

  /**
   * Log a thinking step — visible in real-time in the UI.
   * Use this to show the agent's reasoning as it works.
   */
  async logThinking(ticketId: string, thought: string): Promise<void> {
    await this.supabase.from("agent_logs").insert({
      ticket_id: ticketId,
      agent_name: this.definition.name,
      agent_role: this.definition.role,
      status: "thinking",
      output_summary: thought,
    });
  }

  /**
   * Log agent execution to the database.
   */
  private async log(
    ticketId: string,
    status: "started" | "completed" | "error",
    details: {
      input?: string;
      output?: string;
      error?: string;
      duration?: number;
    },
  ): Promise<void> {
    await this.supabase.from("agent_logs").insert({
      ticket_id: ticketId,
      agent_name: this.definition.name,
      agent_role: this.definition.role,
      status,
      input_summary: details.input ?? null,
      output_summary: details.output ?? null,
      error_message: details.error ?? null,
      duration_ms: details.duration ?? null,
    });
  }

  /**
   * Get the Claude model string for this agent.
   */
  protected getModel(): string {
    return this.definition.model === "sonnet"
      ? "claude-sonnet-4-6-20250514"
      : "claude-haiku-4-5-20251001";
  }
}
