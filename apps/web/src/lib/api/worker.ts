const LOCAL_WORKER_URL = "http://localhost:3001";

function getWorkerSecret(): string | undefined {
  return (
    process.env.WORKER_SHARED_SECRET ??
    process.env.TRIAGEIT_WORKER_SECRET ??
    process.env.INTERNAL_API_SECRET
  );
}

export function getWorkerUrl(): string | null {
  if (process.env.WORKER_URL) return process.env.WORKER_URL;
  if (process.env.NEXT_PUBLIC_WORKER_URL) return process.env.NEXT_PUBLIC_WORKER_URL;
  return process.env.NODE_ENV === "production" ? null : LOCAL_WORKER_URL;
}

export function workerHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const secret = getWorkerSecret();
  if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
    headers.set("X-Worker-Secret", secret);
  }
  return headers;
}

export async function workerFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const configuredWorkerUrl = process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL;
  if (
    process.env.NODE_ENV === "production" &&
    !configuredWorkerUrl &&
    input.startsWith(LOCAL_WORKER_URL)
  ) {
    throw new Error("WORKER_URL not configured");
  }

  const workerUrl = getWorkerUrl();
  if (!workerUrl && !input.startsWith("http")) {
    throw new Error("WORKER_URL not configured");
  }

  const url = input.startsWith("http") ? input : `${workerUrl}${input}`;
  return fetch(url, {
    ...init,
    headers: workerHeaders(init.headers),
  });
}
