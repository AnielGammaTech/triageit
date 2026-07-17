export const AUTH_OPERATION_TIMEOUT_MS = 8_000;
export const CLIENT_REQUEST_TIMEOUT_MS = 20_000;

export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT";

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`);
    this.name = "OperationTimeoutError";
  }
}

export async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label = "Operation",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new OperationTimeoutError(label, timeoutMs)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = CLIENT_REQUEST_TIMEOUT_MS,
  label = "Request",
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  const timeoutId = setTimeout(
    () => controller.abort(new OperationTimeoutError(label, timeoutMs)),
    timeoutMs,
  );

  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new OperationTimeoutError(label, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}
