import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getInterviewByToken } from "@/lib/data";
import { buildInterviewInstructions } from "@/lib/interview-safety";

const schema = z.object({ token: z.string().min(6).max(256), consented: z.literal(true) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valid consent and interview token are required" }, { status: 400 });
  const interview = await getInterviewByToken(parsed.data.token);
  if (!interview) return NextResponse.json({ error: "Interview invitation not found" }, { status: 404 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ configured: false, mode: "text" });

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: process.env.SCREENIT_REALTIME_MODEL ?? "gpt-realtime",
        instructions: buildInterviewInstructions(interview.position, interview.candidate.name.split(" ")[0]),
        audio: {
          input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", create_response: true } },
          output: { voice: process.env.SCREENIT_REALTIME_VOICE ?? "marin" },
        },
      },
    }),
  });
  if (!response.ok) {
    console.error("[ScreenIT] Realtime client secret failed", response.status, await response.text());
    return NextResponse.json({ error: "Voice interview is temporarily unavailable" }, { status: 502 });
  }
  const payload = await response.json() as { value?: string; client_secret?: { value?: string } };
  const clientSecret = payload.value ?? payload.client_secret?.value;
  if (!clientSecret) return NextResponse.json({ error: "Voice session was not issued" }, { status: 502 });
  return NextResponse.json({ configured: true, clientSecret });
}
