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

  /**
   * Fetch all subscriptions for a company, with product names resolved.
   * Pax8's list endpoint often returns only `productId` without the
   * embedded `product` object — we resolve names via `/products/:id`.
   */
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

    // Resolve product names for subs missing the embedded product object
    return this.enrichSubscriptionsWithProductNames(allSubs);
  }

  async getSubscription(subscriptionId: string): Promise<Pax8Subscription> {
    return this.request<Pax8Subscription>(`/subscriptions/${subscriptionId}`);
  }

  // ── Products ────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Pax8Product> {
    return this.request<Pax8Product>(`/products/${productId}`);
  }

  // ── Product Name Resolution ─────────────────────────────────────────

  /**
   * Enrich subscriptions with product names from the /products endpoint.
   * Caches results to avoid duplicate requests for the same product.
   */
  private async enrichSubscriptionsWithProductNames(
    subs: ReadonlyArray<Pax8Subscription>,
  ): Promise<ReadonlyArray<Pax8Subscription>> {
    // Collect unique product IDs that need resolution
    const needsResolution = subs.filter((s) => !s.product?.name && s.productId);
    const uniqueProductIds = [...new Set(needsResolution.map((s) => s.productId))];

    if (uniqueProductIds.length === 0) return subs;

    // Fetch product details in parallel (batch of 10 at a time to avoid rate limits)
    const productMap = new Map<string, Pax8Product>();
    const batches: string[][] = [];
    for (let i = 0; i < uniqueProductIds.length; i += 10) {
      batches.push(uniqueProductIds.slice(i, i + 10));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          const product = await this.getProduct(id);
          productMap.set(id, product);
        }),
      );
      // Log failures but don't break
      for (const r of results) {
        if (r.status === "rejected") {
          console.warn(`[PAX8] Failed to resolve product:`, r.reason);
        }
      }
    }

    // Return new subscription objects with product info attached
    return subs.map((sub) => {
      if (sub.product?.name) return sub;
      const resolved = productMap.get(sub.productId);
      if (!resolved) return sub;
      return {
        ...sub,
        product: {
          id: resolved.id,
          name: resolved.name,
          vendorName: resolved.vendorName,
        },
      };
    });
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
