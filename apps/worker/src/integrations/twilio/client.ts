import type { TwilioConfig } from "@triageit/shared";

/**
 * TwilioClient — Queries Twilio for call/SMS logs and account status.
 *
 * Used by Kelly Kapoor alongside 3CX to check SIP trunk status,
 * call quality, number configuration, and recent call/SMS activity.
 *
 * Auth: HTTP Basic with Account SID and Auth Token.
 *
 * Accuracy contract: list methods return [] only for a successful empty
 * response, and null when the LOOKUP FAILED (auth/network/API error) —
 * callers must treat null as "could not check", NEVER as "no issues".
 */
export class TwilioClient {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly baseUrl: string;

  constructor(config: TwilioConfig) {
    this.accountSid = config.account_sid;
    this.authToken = config.auth_token;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.account_sid}`;
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const credentials = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString("base64");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Twilio API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── Account ────────────────────────────────────────────────────────

  async getAccount(): Promise<TwilioAccount> {
    return this.request<TwilioAccount>("");
  }

  // ── Calls ──────────────────────────────────────────────────────────

  async getCalls(params?: {
    readonly to?: string;
    readonly from?: string;
    readonly status?: string;
    readonly pageSize?: number;
  }): Promise<ReadonlyArray<TwilioCall>> {
    const queryParams: Record<string, string> = {};
    if (params?.to) queryParams.To = params.to;
    if (params?.from) queryParams.From = params.from;
    if (params?.status) queryParams.Status = params.status;
    if (params?.pageSize) queryParams.PageSize = String(params.pageSize);

    const result = await this.request<{ calls: TwilioCall[] }>(
      "/Calls",
      queryParams,
    );
    return result.calls ?? [];
  }

  async getRecentCalls(count: number = 20): Promise<ReadonlyArray<TwilioCall>> {
    return this.getCalls({ pageSize: count });
  }

  async getFailedCalls(count: number = 20): Promise<ReadonlyArray<TwilioCall>> {
    return this.getCalls({ status: "failed", pageSize: count });
  }

  // ── Phone Numbers ──────────────────────────────────────────────────

  async getPhoneNumbers(): Promise<ReadonlyArray<TwilioPhoneNumber>> {
    const result = await this.request<{
      incoming_phone_numbers: TwilioPhoneNumber[];
    }>("/IncomingPhoneNumbers");
    return result.incoming_phone_numbers ?? [];
  }

  async findNumber(
    phoneNumber: string,
  ): Promise<TwilioPhoneNumber | null> {
    const numbers = await this.getPhoneNumbers();
    const normalized = phoneNumber.replace(/\D/g, "");
    return (
      numbers.find(
        (n) =>
          n.phone_number?.replace(/\D/g, "").includes(normalized) ||
          n.friendly_name?.includes(phoneNumber),
      ) ?? null
    );
  }

  /**
   * Look up the US carrier caller-name record for a number. Twilio bills
   * these requests, so callers must cache the result rather than invoking
   * this method directly for every recording.
   */
  async lookupCallerName(phoneNumber: string): Promise<TwilioCallerNameLookup> {
    const normalized = normalizeNorthAmericanPhoneNumber(phoneNumber);
    if (!normalized) {
      throw new Error("Twilio caller-name lookup requires a North American phone number");
    }

    const url = new URL(
      `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(normalized)}`,
    );
    url.searchParams.set("Fields", "caller_name");
    const credentials = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString("base64");
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Twilio Lookup caller name failed (${response.status}): ${body.slice(0, 500)}`,
      );
    }

    const result = (await response.json()) as TwilioCallerNameResponse;
    const callerType = result.caller_name?.caller_type;
    return {
      phoneNumber: result.phone_number ?? normalized,
      callerName: result.caller_name?.caller_name?.trim() || null,
      callerType: callerType === "BUSINESS" || callerType === "CONSUMER" ? callerType : null,
      errorCode: result.caller_name?.error_code ?? null,
    };
  }

  // ── SIP Trunks ─────────────────────────────────────────────────────

  async getSipTrunks(): Promise<ReadonlyArray<TwilioSipTrunk> | null> {
    try {
      const url = `https://trunking.twilio.com/v1/Trunks`;
      const credentials = Buffer.from(
        `${this.accountSid}:${this.authToken}`,
      ).toString("base64");

      const response = await fetch(url, {
        headers: { Authorization: `Basic ${credentials}` },
      });

      if (!response.ok) return null;

      const result = (await response.json()) as { trunks: TwilioSipTrunk[] };
      return result.trunks ?? [];
    } catch {
      return null;
    }
  }

  // ── Messages (SMS) ─────────────────────────────────────────────────

  async getMessages(params?: {
    readonly to?: string;
    readonly from?: string;
    readonly pageSize?: number;
  }): Promise<ReadonlyArray<TwilioMessage>> {
    const queryParams: Record<string, string> = {};
    if (params?.to) queryParams.To = params.to;
    if (params?.from) queryParams.From = params.from;
    if (params?.pageSize) queryParams.PageSize = String(params.pageSize);

    const result = await this.request<{ messages: TwilioMessage[] }>(
      "/Messages",
      queryParams,
    );
    return result.messages ?? [];
  }

  // ── Alerts / Notifications ─────────────────────────────────────────

  async getAlerts(params?: {
    readonly pageSize?: number;
  }): Promise<ReadonlyArray<TwilioAlert> | null> {
    try {
      const url = new URL(
        `https://monitor.twilio.com/v1/Alerts`,
      );
      if (params?.pageSize)
        url.searchParams.set("PageSize", String(params.pageSize));

      const credentials = Buffer.from(
        `${this.accountSid}:${this.authToken}`,
      ).toString("base64");

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Basic ${credentials}` },
      });

      if (!response.ok) return null;

      const result = (await response.json()) as { alerts: TwilioAlert[] };
      return result.alerts ?? [];
    } catch {
      return null;
    }
  }
}

// ── Twilio Types ─────────────────────────────────────────────────────

export function normalizeNorthAmericanPhoneNumber(phoneNumber: string): string | null {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

interface TwilioCallerNameResponse {
  readonly phone_number?: string;
  readonly caller_name?: {
    readonly caller_name?: string | null;
    readonly caller_type?: string | null;
    readonly error_code?: number | null;
  } | null;
}

export interface TwilioCallerNameLookup {
  readonly phoneNumber: string;
  readonly callerName: string | null;
  readonly callerType: "BUSINESS" | "CONSUMER" | null;
  readonly errorCode: number | null;
}

export interface TwilioAccount {
  readonly sid?: string;
  readonly friendly_name?: string;
  readonly status?: string;
  readonly type?: string;
  readonly date_created?: string;
  readonly [key: string]: unknown;
}

export interface TwilioCall {
  readonly sid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly status?: string;
  readonly start_time?: string;
  readonly end_time?: string;
  readonly duration?: string;
  readonly direction?: string;
  readonly price?: string;
  readonly price_unit?: string;
  readonly [key: string]: unknown;
}

export interface TwilioPhoneNumber {
  readonly sid?: string;
  readonly phone_number?: string;
  readonly friendly_name?: string;
  readonly voice_url?: string;
  readonly sms_url?: string;
  readonly status?: string;
  readonly capabilities?: {
    readonly voice?: boolean;
    readonly sms?: boolean;
    readonly mms?: boolean;
    readonly fax?: boolean;
  };
  readonly trunk_sid?: string;
  readonly [key: string]: unknown;
}

export interface TwilioSipTrunk {
  readonly sid?: string;
  readonly friendly_name?: string;
  readonly domain_name?: string;
  readonly secure?: boolean;
  readonly recording?: unknown;
  readonly cnam_lookup_enabled?: boolean;
  readonly [key: string]: unknown;
}

export interface TwilioMessage {
  readonly sid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly body?: string;
  readonly status?: string;
  readonly direction?: string;
  readonly date_sent?: string;
  readonly [key: string]: unknown;
}

export interface TwilioAlert {
  readonly sid?: string;
  readonly alert_text?: string;
  readonly error_code?: string;
  readonly log_level?: string;
  readonly date_created?: string;
  readonly resource_sid?: string;
  readonly [key: string]: unknown;
}
