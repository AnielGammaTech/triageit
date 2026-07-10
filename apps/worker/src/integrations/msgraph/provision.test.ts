import { describe, expect, it } from "vitest";
import { decodeJwtClaim } from "./auth.js";
import { provisionGraphApp } from "./provision.js";
import type { ProvisionStepKey, ProvisionStepStatus } from "./provision.js";

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FakeGraphOptions {
  /** Number of token requests that fail before one succeeds. */
  readonly tokenFailures?: number;
  /** Fail the application create call. */
  readonly failCreateApp?: boolean;
}

function makeFakeGraph(options: FakeGraphOptions = {}) {
  const calls: RecordedCall[] = [];
  let tokenFailuresLeft = options.tokenFailures ?? 0;

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const rawBody = typeof init?.body === "string" ? init.body : init?.body?.toString();
    let body: unknown = rawBody;
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      // Form-encoded token bodies stay as strings.
    }
    calls.push({ url, method, body });

    if (url.includes("/oauth2/v2.0/token")) {
      if (tokenFailuresLeft > 0) {
        tokenFailuresLeft -= 1;
        return jsonResponse(401, {
          error: "invalid_client",
          error_description: "AADSTS7000215: secret not yet propagated",
        });
      }
      return jsonResponse(200, { access_token: "app-token" });
    }
    if (url.endsWith("/applications") && method === "POST") {
      if (options.failCreateApp) {
        return jsonResponse(403, {
          error: { code: "Authorization_RequestDenied", message: "Insufficient privileges" },
        });
      }
      return jsonResponse(201, { id: "app-object-id", appId: "new-client-id" });
    }
    if (url.includes("/applications/app-object-id/addPassword")) {
      return jsonResponse(200, { secretText: "s3cret-value" });
    }
    if (url.endsWith("/servicePrincipals") && method === "POST") {
      return jsonResponse(201, { id: "new-sp-id" });
    }
    if (url.includes("/servicePrincipals?$filter=")) {
      return jsonResponse(200, { value: [{ id: "graph-sp-id" }] });
    }
    if (url.includes("/appRoleAssignedTo")) {
      return jsonResponse(201, { id: "assignment-id" });
    }
    if (url.includes("/users?$top=1")) {
      return jsonResponse(200, { value: [{ id: "some-user" }] });
    }
    return jsonResponse(404, { error: { code: "NotFound", message: `unmatched ${url}` } });
  }) as typeof fetch;

  return { fetchFn, calls };
}

const noSleep = async (): Promise<void> => undefined;

describe("provisionGraphApp", () => {
  it("provisions app, secret, service principal, consent, then verifies", async () => {
    const { fetchFn, calls } = makeFakeGraph();
    const stepLog: Array<`${ProvisionStepKey}:${ProvisionStepStatus}`> = [];

    const result = await provisionGraphApp("delegated-token", "tenant-123", {
      fetchFn,
      sleep: noSleep,
      onStep: (key, status) => stepLog.push(`${key}:${status}`),
    });

    expect(result.tenant_id).toBe("tenant-123");
    expect(result.client_id).toBe("new-client-id");
    expect(result.client_secret).toBe("s3cret-value");
    expect(result.app_object_id).toBe("app-object-id");
    expect(result.consented_at).toBeTruthy();

    expect(stepLog).toEqual([
      "create_app:active",
      "create_app:done",
      "add_secret:active",
      "add_secret:done",
      "service_principal:active",
      "service_principal:done",
      "admin_consent:active",
      "admin_consent:done",
      "verify:active",
      "verify:done",
    ]);

    const createApp = calls.find((c) => c.url.endsWith("/applications") && c.method === "POST");
    const manifest = createApp?.body as {
      signInAudience: string;
      requiredResourceAccess: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: string }> }>;
    };
    expect(manifest.signInAudience).toBe("AzureADMyOrg");
    expect(manifest.requiredResourceAccess[0].resourceAccess).toEqual([
      { id: "ef54d2bf-783f-4e0f-bca1-3210c0444d99", type: "Role" },
    ]);

    const consent = calls.find((c) => c.url.includes("/appRoleAssignedTo"));
    expect(consent?.body).toEqual({
      principalId: "new-sp-id",
      resourceId: "graph-sp-id",
      appRoleId: "ef54d2bf-783f-4e0f-bca1-3210c0444d99",
    });

    // Verify uses the NEW app's credentials, not the delegated token.
    const tokenCall = calls.find((c) => c.url.includes("/tenant-123/oauth2/v2.0/token"));
    expect(String(tokenCall?.body)).toContain("client_id=new-client-id");
  });

  it("retries verification while the new secret propagates", async () => {
    const { fetchFn, calls } = makeFakeGraph({ tokenFailures: 3 });

    const result = await provisionGraphApp("delegated-token", "tenant-123", {
      fetchFn,
      sleep: noSleep,
    });

    expect(result.client_id).toBe("new-client-id");
    const tokenCalls = calls.filter((c) => c.url.includes("/tenant-123/oauth2/v2.0/token"));
    expect(tokenCalls.length).toBe(4);
  });

  it("surfaces a step error when app creation is denied", async () => {
    const { fetchFn } = makeFakeGraph({ failCreateApp: true });
    const errors: string[] = [];

    await expect(
      provisionGraphApp("delegated-token", "tenant-123", {
        fetchFn,
        sleep: noSleep,
        onStep: (key, status, detail) => {
          if (status === "error") errors.push(`${key}: ${detail ?? ""}`);
        },
      }),
    ).rejects.toThrow(/Authorization_RequestDenied/);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("create_app");
  });
});

describe("decodeJwtClaim", () => {
  it("reads the tid claim from an unsigned token payload", () => {
    const payload = Buffer.from(JSON.stringify({ tid: "tenant-abc" })).toString("base64url");
    expect(decodeJwtClaim(`header.${payload}.sig`, "tid")).toBe("tenant-abc");
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtClaim("not-a-jwt", "tid")).toBeNull();
    expect(decodeJwtClaim("a.%%%.c", "tid")).toBeNull();
  });
});
