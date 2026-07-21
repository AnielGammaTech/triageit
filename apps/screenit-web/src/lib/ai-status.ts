import "server-only";

export interface AiConfiguration {
  readonly provider: "OpenAI";
  readonly configured: boolean;
  readonly realtimeModel: string;
  readonly realtimeVoice: string;
  readonly reportModel: string;
  readonly resumeModel: string;
}

export interface AiConnectionStatus {
  readonly state: "connected" | "degraded" | "not_configured";
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly reportModelReady: boolean;
  readonly realtimeReady: boolean;
  readonly message: string;
}

export interface VoiceBridgeStatus {
  readonly state: "connected" | "degraded" | "not_configured";
  readonly threeCxReady: boolean;
  readonly realtimeReady: boolean;
  readonly routePoint: string | null;
  readonly message: string;
}

export function getAiConfiguration(): AiConfiguration {
  const reportModel = process.env.SCREENIT_REPORT_MODEL ?? "gpt-5-mini";
  return {
    provider: "OpenAI",
    configured: Boolean(process.env.OPENAI_API_KEY),
    realtimeModel: process.env.SCREENIT_REALTIME_MODEL ?? "gpt-realtime",
    realtimeVoice: process.env.SCREENIT_REALTIME_VOICE ?? "marin",
    reportModel,
    resumeModel: process.env.SCREENIT_RESUME_MODEL ?? reportModel,
  };
}

export async function testAiConnection(): Promise<AiConnectionStatus> {
  const configuration = getAiConfiguration();
  const checkedAt = new Date().toISOString();
  if (!process.env.OPENAI_API_KEY) {
    return {
      state: "not_configured",
      checkedAt,
      latencyMs: null,
      reportModelReady: false,
      realtimeReady: false,
      message: "Add OPENAI_API_KEY to the ScreenIT Railway service.",
    };
  }

  const startedAt = Date.now();
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  const reportCheck = fetch(`https://api.openai.com/v1/models/${encodeURIComponent(configuration.reportModel)}`, {
    headers,
    cache: "no-store",
  });
  const realtimeCheck = fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: configuration.realtimeModel,
        instructions: "Connection test only. Do not begin an interview.",
        audio: { output: { voice: configuration.realtimeVoice } },
      },
    }),
    cache: "no-store",
  });

  try {
    const [reportResponse, realtimeResponse] = await Promise.all([reportCheck, realtimeCheck]);
    const reportModelReady = reportResponse.ok;
    const realtimeReady = realtimeResponse.ok;
    const connected = reportModelReady && realtimeReady;
    return {
      state: connected ? "connected" : "degraded",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      reportModelReady,
      realtimeReady,
      message: connected
        ? "OpenAI voice interviews and evidence reports are ready."
        : "OpenAI responded, but one configured model needs attention.",
    };
  } catch {
    return {
      state: "degraded",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      reportModelReady: false,
      realtimeReady: false,
      message: "ScreenIT could not reach OpenAI. Try the connection test again.",
    };
  }
}

export async function testVoiceBridge(): Promise<VoiceBridgeStatus> {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WORKER_SHARED_SECRET ?? process.env.TRIAGEIT_WORKER_SECRET;
  if (!url || !secret) return { state: "not_configured", threeCxReady: false, realtimeReady: false, routePoint: null, message: "Add the worker URL and shared secret to enable outbound calls." };
  try {
    const response = await fetch(`${url}/screenit-call-status`, { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Worker returned ${response.status}`);
    const payload = await response.json() as { state?: string; threeCxReady?: boolean; realtimeReady?: boolean; routePoint?: string };
    const connected = payload.state === "connected" && payload.threeCxReady === true && payload.realtimeReady === true;
    return { state: connected ? "connected" : "degraded", threeCxReady: payload.threeCxReady === true, realtimeReady: payload.realtimeReady === true, routePoint: payload.routePoint ?? null, message: connected ? "3CX outbound AI screening calls are ready." : "The phone worker is online, but 3CX or Realtime AI needs attention." };
  } catch (error) {
    return { state: "degraded", threeCxReady: false, realtimeReady: false, routePoint: null, message: `The ScreenIT phone worker could not be reached: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}
