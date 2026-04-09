// apps/worker/src/memory/skill-extractor.ts

import type { SkillType } from "@triageit/shared";

/**
 * SkillExtractor — parses <skill> tags from LLM output.
 *
 * Agents can create reusable skills by embedding <skill> tags:
 *   <skill type="procedure" title="HP LaserJet driver fix">When you see error 0x800...</skill>
 *
 * Unlike memories (episodic, client-specific), skills are:
 * - Reusable across any client
 * - Structured as procedures/runbooks/instructions
 * - Deduplicated by title similarity
 */

export interface ExtractedSkill {
  readonly title: string;
  readonly content: string;
  readonly skill_type: SkillType;
}

const VALID_SKILL_TYPES: ReadonlySet<string> = new Set([
  "instruction",
  "procedure",
  "runbook",
  "template",
  "context",
]);

const SKILL_REGEX =
  /<skill(?:\s+type="([^"]*)")?(?:\s+title="([^"]*)")?>([^<]+)<\/skill>/gi;

/**
 * Extract all <skill> tags from an LLM response string.
 */
export function extractSkillTags(
  text: string,
): ReadonlyArray<ExtractedSkill> {
  const skills: ExtractedSkill[] = [];

  let match: RegExpExecArray | null;
  SKILL_REGEX.lastIndex = 0;

  while ((match = SKILL_REGEX.exec(text)) !== null) {
    const rawType = match[1]?.trim().toLowerCase() ?? "procedure";
    const title = match[2]?.trim() ?? "";
    const content = match[3]?.trim() ?? "";

    if (content.length === 0 || title.length === 0) continue;

    const skillType: SkillType = VALID_SKILL_TYPES.has(rawType)
      ? (rawType as SkillType)
      : "procedure";

    skills.push({ title, content, skill_type: skillType });
  }

  return skills;
}

/**
 * Strip <skill> tags from text for clean display.
 */
export function stripSkillTags(text: string): string {
  return text.replace(SKILL_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Instruction block to inject into agent system prompts.
 * Teaches agents when and how to write skills.
 */
export const SKILL_INSTRUCTIONS = `
## Skill System
You can create reusable procedures by embedding <skill> tags in your response.
Skills are different from memories: they are REUSABLE across any client, not tied to one ticket.

Only create a skill when you discover something genuinely reusable:
- A troubleshooting procedure that works for a category of issues
- A vendor-specific fix (driver download URL, configuration steps)
- An escalation checklist for a specific technology
- A diagnostic template that helps classify similar issues faster

Do NOT create skills for:
- Client-specific information (use <remember> instead)
- One-off fixes that won't recur
- Obvious IT knowledge that any tech would know

Syntax:
  <skill type="TYPE" title="Short Descriptive Title">Detailed procedure or knowledge</skill>

Types:
  - procedure: Step-by-step troubleshooting for a specific issue category
  - runbook: Detailed operational guide for a technology/vendor
  - instruction: General guidance for handling a class of tickets

Examples:
  <skill type="procedure" title="HP LaserJet M400 series driver fix">For HP LaserJet M400 series showing error 0x80070705 after Windows update: 1. Download UPD from https://support.hp.com/drivers 2. Remove existing driver via Print Management 3. Install UPD in dynamic mode 4. Set printer to use UPD driver</skill>
  <skill type="runbook" title="SonicWall VPN client troubleshooting">When Global VPN Client shows 'No proposal chosen': 1. Check Phase 2 proposals match on both sides 2. Verify the SA lifetime matches 3. Check NAT traversal is enabled if behind NAT</skill>
`.trim();
