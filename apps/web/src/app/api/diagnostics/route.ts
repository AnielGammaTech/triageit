import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface TestResult {
  readonly service: string;
  readonly label: string;
  readonly status: "ok" | "error" | "skipped";
  readonly message: string;
  readonly latency_ms: number | null;
  readonly details?: Record<string, unknown>;
}

async function testAnthropicKey(apiKey: string): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-20250514",
        max_tokens: 5,
        messages: [{ role: "user", content: "Say OK" }],
      }),
    });

    const latency = Date.now() - start;
    const data = await res.json();

    if (res.ok) {
      return {
        service: "claude",
        label: "Claude (Anthropic)",
        status: "ok",
        message: `API key valid. Model responded in ${latency}ms.`,
        latency_ms: latency,
        details: {
          model: data.model,
          usage: data.usage,
        },
      };
    }

    return {
      service: "claude",
      label: "Claude (Anthropic)",
      status: "error",
      message: data.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
      latency_ms: latency,
      details: { type: data.error?.type, status: res.status },
    };
  } catch (err) {
    return {
      service: "claude",
      label: "Claude (Anthropic)",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testOpenAIKey(apiKey: string): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const latency = Date.now() - start;
    const data = await res.json();

    if (res.ok) {
      return {
        service: "openai",
        label: "OpenAI",
        status: "ok",
        message: `API key valid. ${data.data?.length ?? 0} models available.`,
        latency_ms: latency,
      };
    }

    return {
      service: "openai",
      label: "OpenAI",
      status: "error",
      message: data.error?.message ?? `HTTP ${res.status}`,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      service: "openai",
      label: "OpenAI",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testHaloConnection(config: Record<string, string>): Promise<TestResult> {
  const start = Date.now();
  const baseUrl = config.base_url?.replace(/\/+$/, "");
  if (!baseUrl || !config.client_id || !config.client_secret) {
    return {
      service: "halo",
      label: "Halo PSA",
      status: "skipped",
      message: "Missing base_url, client_id, or client_secret.",
      latency_ms: null,
    };
  }

  try {
    const tokenRes = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id,
        client_secret: config.client_secret,
        scope: "all",
      }),
    });

    const latency = Date.now() - start;
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        service: "halo",
        label: "Halo PSA",
        status: "error",
        message: tokenData.error_description ?? tokenData.error ?? `Auth failed (HTTP ${tokenRes.status})`,
        latency_ms: latency,
      };
    }

    return {
      service: "halo",
      label: "Halo PSA",
      status: "ok",
      message: `Authenticated successfully in ${latency}ms.`,
      latency_ms: latency,
      details: { token_type: tokenData.token_type, expires_in: tokenData.expires_in },
    };
  } catch (err) {
    return {
      service: "halo",
      label: "Halo PSA",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testHuduConnection(config: Record<string, string>): Promise<TestResult> {
  const start = Date.now();
  const baseUrl = config.base_url?.replace(/\/+$/, "");
  const apiKey = config.api_key;
  if (!baseUrl || !apiKey) {
    return {
      service: "hudu",
      label: "Hudu",
      status: "skipped",
      message: "Missing base_url or api_key.",
      latency_ms: null,
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/companies?page=1&page_size=1`, {
      headers: { "x-api-key": apiKey },
    });

    const latency = Date.now() - start;

    if (res.ok) {
      return {
        service: "hudu",
        label: "Hudu",
        status: "ok",
        message: `Connected successfully in ${latency}ms.`,
        latency_ms: latency,
      };
    }

    return {
      service: "hudu",
      label: "Hudu",
      status: "error",
      message: `HTTP ${res.status}: ${res.statusText}`,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      service: "hudu",
      label: "Hudu",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testDattoConnection(config: Record<string, string>): Promise<TestResult> {
  const start = Date.now();
  const apiUrl = (config.api_url ?? config.base_url)?.replace(/\/+$/, "");
  const apiKey = config.api_key;
  const apiSecret = config.api_secret ?? config.secret_key;
  if (!apiUrl || !apiKey || !apiSecret) {
    return {
      service: "datto",
      label: "Datto RMM",
      status: "skipped",
      message: "Missing api_url, api_key, or api_secret.",
      latency_ms: null,
    };
  }

  try {
    const authRes = await fetch(`${apiUrl}/auth/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });

    const latency = Date.now() - start;

    if (authRes.ok) {
      return {
        service: "datto",
        label: "Datto RMM",
        status: "ok",
        message: `Authenticated successfully in ${latency}ms.`,
        latency_ms: latency,
      };
    }

    const data = await authRes.json().catch(() => ({}));
    return {
      service: "datto",
      label: "Datto RMM",
      status: "error",
      message: (data as Record<string, string>).error ?? `HTTP ${authRes.status}`,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      service: "datto",
      label: "Datto RMM",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testWorkerHealth(workerUrl: string): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const latency = Date.now() - start;
    const data = await res.json();

    if (res.ok && data.status === "ok") {
      return {
        service: "worker",
        label: "TriageIT Worker",
        status: "ok",
        message: `Worker healthy (${latency}ms).`,
        latency_ms: latency,
      };
    }

    return {
      service: "worker",
      label: "TriageIT Worker",
      status: "error",
      message: `Worker responded with: ${JSON.stringify(data)}`,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      service: "worker",
      label: "TriageIT Worker",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testRedis(): Promise<TestResult> {
  // We can't test Redis directly from the web app, but we can check the worker health
  return {
    service: "redis",
    label: "Redis (BullMQ)",
    status: "skipped",
    message: "Redis connectivity is validated through the Worker health check.",
    latency_ms: null,
  };
}

async function testSupabase(): Promise<TestResult> {
  const start = Date.now();
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { count, error } = await supabase
      .from("tickets")
      .select("*", { count: "exact", head: true });

    const latency = Date.now() - start;

    if (error) {
      return {
        service: "supabase",
        label: "Supabase Database",
        status: "error",
        message: error.message,
        latency_ms: latency,
      };
    }

    return {
      service: "supabase",
      label: "Supabase Database",
      status: "ok",
      message: `Connected. ${count ?? 0} tickets in database (${latency}ms).`,
      latency_ms: latency,
      details: { ticket_count: count },
    };
  } catch (err) {
    return {
      service: "supabase",
      label: "Supabase Database",
      status: "error",
      message: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

async function testGenericIntegration(
  service: string,
  label: string,
  config: Record<string, string> | undefined,
  testFn: (cfg: Record<string, string>) => Promise<TestResult>,
): Promise<TestResult> {
  if (!config || Object.values(config).every((v) => !v)) {
    return {
      service,
      label,
      status: "skipped",
      message: "Not configured. Go to Integrations to set it up.",
      latency_ms: null,
    };
  }
  return testFn(config);
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id);
  if (rateLimited) return rateLimited;

  try {
    const { services } = (await request.json()) as { services?: string[] };

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load all integration configs
    const { data: integrations } = await supabase
      .from("integrations")
      .select("service, config, is_active");

    const configMap: Record<string, Record<string, string>> = {};
    for (const row of integrations ?? []) {
      configMap[row.service as string] = row.config as Record<string, string>;
    }

    const aiConfig = configMap["ai-provider"] ?? {};
    const workerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:3001";

    const allTests: Array<Promise<TestResult>> = [];

    const shouldTest = (svc: string) => !services || services.includes(svc);

    // Infrastructure
    if (shouldTest("supabase")) allTests.push(testSupabase());
    if (shouldTest("worker")) allTests.push(testWorkerHealth(workerUrl));
    if (shouldTest("redis")) allTests.push(testRedis());

    // AI Providers
    if (shouldTest("claude") && aiConfig.claude_api_key) {
      allTests.push(testAnthropicKey(aiConfig.claude_api_key));
    } else if (shouldTest("claude")) {
      allTests.push(
        Promise.resolve({
          service: "claude",
          label: "Claude (Anthropic)",
          status: "skipped" as const,
          message: "No API key configured. Go to Integrations → AI Provider to add one.",
          latency_ms: null,
        }),
      );
    }

    if (shouldTest("openai") && aiConfig.openai_api_key) {
      allTests.push(testOpenAIKey(aiConfig.openai_api_key));
    } else if (shouldTest("openai")) {
      allTests.push(
        Promise.resolve({
          service: "openai",
          label: "OpenAI",
          status: "skipped" as const,
          message: "No API key configured.",
          latency_ms: null,
        }),
      );
    }

    // Integrations
    // Integrations — test all configured services
    const integrationTests: ReadonlyArray<{
      id: string;
      label: string;
      test: (cfg: Record<string, string>) => Promise<TestResult>;
    }> = [
      { id: "halo", label: "Halo PSA", test: testHaloConnection },
      { id: "hudu", label: "Hudu", test: testHuduConnection },
      { id: "datto", label: "Datto RMM", test: testDattoConnection },
    ];

    for (const it of integrationTests) {
      if (shouldTest(it.id)) {
        allTests.push(testGenericIntegration(it.id, it.label, configMap[it.id], it.test));
      }
    }

    const results = await Promise.all(allTests);

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
