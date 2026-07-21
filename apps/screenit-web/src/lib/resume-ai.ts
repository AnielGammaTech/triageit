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
1. Up to six explicit, job-related resume facts relevant to the role. Preserve the employer name, job title, named tool, and stated responsibility when they appear so the interviewer can sound like it actually read the resume.
2. Neutral clarifications for missing or unclear job-related evidence, including unexplained timeline gaps only when the dates are explicitly present. Never assume why a gap exists.
3. Three to six concise interview questions in this order:
   - Begin with two or three questions that explicitly reference an employer, job title, tool, project, or responsibility written on this resume, starting with the most recent role-related work.
   - Then clarify any missing or unclear role evidence.
   - Then test the core role requirements with concrete work examples.

Every question must use plain spoken English, contain one idea, and be easy to understand on a phone call. Keep it to one sentence and preferably under 24 words. Do not combine "what, how, and why" into one question. Never write a yes-or-no main question beginning with "Did," "Do," "Are," "Can," "Was," or "Have." Use an open invitation such as "Tell me," "Walk me through," "Which," or "What." Depth should come from short follow-up questions during the conversation, not from a complicated main question. Include employer-approved questions when useful, but simplify their wording without changing their intent.

For an MSP, service desk, help desk, or IT technician role, make sure the complete question set gathers evidence about:
- Supporting multiple customer environments in an MSP or similar setting.
- Hands-on use of RMM tools and what the candidate actually did in them.
- PSA or ticketing systems, ticket ownership, prioritization, escalation, and closure.
- Clear ticket notes, technical documentation, and customer-facing updates.
- A real remote troubleshooting example from first report through resolution.
- What first drew the candidate into IT and what currently keeps them learning.
- A real time they did not know the answer, how they sought help, and what they learned.

Ask for tool names when relevant, but accept comparable tools and workflows. If the resume does not state MSP, RMM, PSA, documentation, or ticketing experience, ask neutrally instead of treating it as absent.

Resume questions should sound like a recruiter who read the document. For example: "I see on your resume that you supported multiple clients at Acme MSP; what did you handle there day to day?" Never invent a company, title, tool, or responsibility that is not explicitly in the resume.

Do not infer passion, humility, personality, or enthusiasm from tone. Gather the candidate's stated motivation and concrete learning behavior so a human recruiter can evaluate it.

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
