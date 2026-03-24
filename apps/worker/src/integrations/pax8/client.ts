import type { Pax8Config } from "@triageit/shared";

/**
 * Pax8 API Client — Cloud marketplace licensing data.
 *
 * OAuth2 client_credentials flow to https://login.pax8.com
 * API base: https://api.pax8.com/v1
 */

const TOKEN_URL = "https://login.pax8.com/oauth/token";
const API_BASE = "https://api.pax8.com/v1";
const AUDIENCE = "https://api.pax8.com";

export class Pax8Client {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: Pax8Config) {
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
  }

  // ── Authentication ──────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        audience: AUDIENCE,
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pax8 auth failed (${res.status}): ${text.substring(0, 200)}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  // ── Generic Request ─────────────────────────────────────────────────

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getAccessToken();

    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pax8 API ${path} failed (${res.status}): ${text.substring(0, 300)}`);
    }

    return (await res.json()) as T;
  }

  // ── Companies ───────────────────────────────────────────────────────

  async getCompanies(): Promise<ReadonlyArray<Pax8Company>> {
    const data = await this.request<Pax8PagedResponse<Pax8Company>>("/companies", {
      size: "200",
      sort: "name",
      sortDirection: "asc",
    });
    return data.content ?? [];
  }

  async getCompany(companyId: string): Promise<Pax8Company> {
    return this.request<Pax8Company>(`/companies/${companyId}`);
  }

  async searchCompanies(name: string): Promise<ReadonlyArray<Pax8Company>> {
    const companies = await this.getCompanies();
    const lower = name.toLowerCase();
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        lower.includes(c.name.toLowerCase()),
    );
  }

  // ── Subscriptions ───────────────────────────────────────────────────

  async getSubscriptions(companyId: string): Promise<ReadonlyArray<Pax8Subscription>> {
    const allSubs: Pax8Subscription[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const data = await this.request<Pax8PagedResponse<Pax8Subscription>>(
        "/subscriptions",
        {
          companyId,
          size: "100",
          page: String(page),
        },
      );

      allSubs.push(...(data.content ?? []));

      const totalPages = data.page?.totalPages ?? 1;
      page++;
      hasMore = page < totalPages;
    }

    return allSubs;
  }

  async getSubscription(subscriptionId: string): Promise<Pax8Subscription> {
    return this.request<Pax8Subscription>(`/subscriptions/${subscriptionId}`);
  }

  // ── Products ────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Pax8Product> {
    return this.request<Pax8Product>(`/products/${productId}`);
  }
}

// ── Types ──────────────────────────────────────────────────────────────

interface Pax8PagedResponse<T> {
  readonly content?: ReadonlyArray<T>;
  readonly page?: {
    readonly size: number;
    readonly totalElements: number;
    readonly totalPages: number;
    readonly number: number;
  };
}

export interface Pax8Company {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly website?: string;
  readonly phone?: string;
  readonly city?: string;
  readonly stateOrProvince?: string;
  readonly country?: string;
  readonly [key: string]: unknown;
}

export interface Pax8Subscription {
  readonly id: string;
  readonly companyId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly startDate: string;
  readonly endDate?: string;
  readonly createdDate?: string;
  readonly billingTerm: string;
  readonly status: string;
  readonly price?: number;
  readonly billingCycle?: string;
  readonly commitment?: {
    readonly term?: string;
    readonly endDate?: string;
  };
  readonly product?: {
    readonly id: string;
    readonly name: string;
    readonly vendorName?: string;
  };
  readonly [key: string]: unknown;
}

export interface Pax8Product {
  readonly id: string;
  readonly name: string;
  readonly vendorName?: string;
  readonly sku?: string;
  readonly [key: string]: unknown;
}
