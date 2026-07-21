import "server-only";

import type { InterviewQuestion, Position } from "@/lib/screenit-types";

export interface ResumeAnalysis {
  readonly highlights: readonly string[];
  readonly clarifications: readonly string[];
  readonly questions: readonly InterviewQuestion[];
}

function outputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("output" in payload) || !Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === "object" && "type" in content && content.type === "output_text" && "text" in content && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

const emptyAnalysis: ResumeAnalysis = { highlights: [], clarifications: [], questions: [] };

export async function analyzeResume(resume: File, position: Position): Promise<ResumeAnalysis> {
  if (!process.env.OPENAI_API_KEY) return emptyAnalysis;
  const mimeType = resume.type || "application/octet-stream";
  const fileData = `data:${mimeType};base64,${Buffer.from(await resume.arrayBuffer()).toString("base64")}`;
  const model = process.env.SCREENIT_RESUME_MODEL ?? process.env.SCREENIT_REPORT_MODEL ?? "gpt-5-mini";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        input: [{
          role: "user",
          content: [
            { type: "input_file", filename: resume.name, file_data: fileData },
            {
              type: "input_text",
              text: `Prepare a structured screening plan for the ${position.title} role.

Return:
1. Up to six explicit, job-related resume facts relevant to the role.
2. Neutral clarifications for missing or unclear job-related evidence, including unexplained timeline gaps only when the dates are explicitly present. Never assume why a gap exists.
3. Three to six concise interview questions that test the role requirements, validate resume claims with concrete examples, and clarify missing evidence. Include the employer-approved questions when useful.

Use only explicit resume content. Do not include or infer age, race, ethnicity, nationality, religion, sex, gender, disability, health, family status, photo details, or other protected information.

Role requirements:
${position.requirements.map((item) => `- ${item}`).join("\n")}

Employer-approved questions:
${position.questions.map((item) => `- ${item.prompt}`).join("\n") || "None provided"}`,
            },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "resume_job_evidence",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["highlights", "clarifications", "questions"],
              properties: {
                highlights: { type: "array", maxItems: 6, items: { type: "string" } },
                clarifications: { type: "array", maxItems: 4, items: { type: "string" } },
                questions: {
                  type: "array",
                  minItems: 3,
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["prompt", "reason"],
                    properties: { prompt: { type: "string" }, reason: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Resume model returned ${response.status}`);
    const parsed = JSON.parse(outputText(await response.json()) ?? "{}") as ResumeAnalysis;
    const highlights = Array.isArray(parsed.highlights) ? parsed.highlights.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6) : [];
    const clarifications = Array.isArray(parsed.clarifications) ? parsed.clarifications.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4) : [];
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((item) => item && typeof item.prompt === "string" && typeof item.reason === "string").slice(0, 6).map((item, index) => ({ id: `candidate-q${index + 1}`, prompt: item.prompt, reason: item.reason, required: true }))
      : [];
    return { highlights, clarifications, questions };
  } catch (error) {
    console.error("[ScreenIT] Resume analysis failed", error);
    return emptyAnalysis;
  }
}
