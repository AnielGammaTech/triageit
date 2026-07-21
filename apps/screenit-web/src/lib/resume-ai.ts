import "server-only";

import type { Position } from "@/lib/screenit-types";

interface ResumeAnalysis {
  readonly highlights: readonly string[];
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

export async function extractResumeHighlights(resume: File, position: Position): Promise<readonly string[]> {
  if (!process.env.OPENAI_API_KEY) return [];
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
              text: `Extract up to six concise, job-related resume facts relevant to the ${position.title} role. Use only explicit resume content. Do not include or infer age, race, ethnicity, nationality, religion, sex, gender, disability, health, family status, photo details, or other protected information. Role requirements:\n${position.requirements.map((item) => `- ${item}`).join("\n")}`,
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
              required: ["highlights"],
              properties: { highlights: { type: "array", maxItems: 6, items: { type: "string" } } },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Resume model returned ${response.status}`);
    const parsed = JSON.parse(outputText(await response.json()) ?? "{}") as ResumeAnalysis;
    return Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6)
      : [];
  } catch (error) {
    console.error("[ScreenIT] Resume analysis failed", error);
    return [];
  }
}
