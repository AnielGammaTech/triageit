import type { HuduConfig } from "@triageit/shared";

/**
 * HuduClient — Queries Hudu IT documentation platform.
 *
 * Used by Dwight Schrute to pull real KB articles, assets, passwords,
 * procedures, and documentation for ticket triage.
 */
export class HuduClient {
  constructor(private readonly config: HuduConfig) {}

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.config.base_url}/api/v1${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.config.api_key,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hudu API ${path} failed (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
  }

  // ── Companies ────────────────────────────────────────────────────

  async getCompanies(): Promise<ReadonlyArray<HuduCompany>> {
    const result = await this.request<{ companies: HuduCompany[] }>(
      "/companies",
      { page_size: "500" },
    );
    return result.companies ?? [];
  }

  async getCompany(companyId: number): Promise<HuduCompany> {
    const result = await this.request<{ company: HuduCompany }>(
      `/companies/${companyId}`,
    );
    return result.company;
  }

  async searchCompanies(name: string): Promise<ReadonlyArray<HuduCompany>> {
    const result = await this.request<{ companies: HuduCompany[] }>(
      "/companies",
      { name },
    );
    return result.companies ?? [];
  }

  // ── KB Articles ──────────────────────────────────────────────────

  async getArticles(params?: {
    readonly company_id?: number;
    readonly name?: string;
    readonly page_size?: number;
  }): Promise<ReadonlyArray<HuduArticle>> {
    const queryParams: Record<string, string> = {
      page_size: String(params?.page_size ?? 50),
    };
    if (params?.company_id) queryParams.company_id = String(params.company_id);
    if (params?.name) queryParams.name = params.name;

    const result = await this.request<{ articles: HuduArticle[] }>(
      "/articles",
      queryParams,
    );
    return result.articles ?? [];
  }

  async searchArticles(query: string, companyId?: number): Promise<ReadonlyArray<HuduArticle>> {
    const params: Record<string, string> = {
      name: query,
      page_size: "20",
    };
    if (companyId) params.company_id = String(companyId);

    const result = await this.request<{ articles: HuduArticle[] }>(
      "/articles",
      params,
    );
    return result.articles ?? [];
  }

  // ── Assets (Computer Assets, Printers, Network devices, etc.) ──

  async getAssets(params?: {
    readonly company_id?: number;
    readonly asset_layout_id?: number;
    readonly name?: string;
    readonly page_size?: number;
  }): Promise<ReadonlyArray<HuduAsset>> {
    const queryParams: Record<string, string> = {
      page_size: String(params?.page_size ?? 50),
    };
    if (params?.company_id) queryParams.company_id = String(params.company_id);
    if (params?.asset_layout_id) queryParams.asset_layout_id = String(params.asset_layout_id);
    if (params?.name) queryParams.name = params.name;

    const result = await this.request<{ assets: HuduAsset[] }>(
      "/assets",
      queryParams,
    );
    return result.assets ?? [];
  }

  async getAsset(assetId: number): Promise<HuduAsset> {
    const result = await this.request<{ asset: HuduAsset }>(
      `/assets/${assetId}`,
    );
    return result.asset;
  }

  async searchAssets(
    query: string,
    companyId?: number,
  ): Promise<ReadonlyArray<HuduAsset>> {
    const params: Record<string, string> = {
      name: query,
      page_size: "25",
    };
    if (companyId) params.company_id = String(companyId);

    const result = await this.request<{ assets: HuduAsset[] }>(
      "/assets",
      params,
    );
    return result.assets ?? [];
  }

  // ── Asset Layouts (to identify Printing, Network, etc.) ────────

  async getAssetLayouts(): Promise<ReadonlyArray<HuduAssetLayout>> {
    const result = await this.request<{ asset_layouts: HuduAssetLayout[] }>(
      "/asset_layouts",
    );
    return result.asset_layouts ?? [];
  }

  // ── Passwords ────────────────────────────────────────────────────

  async getPasswords(params?: {
    readonly company_id?: number;
    readonly name?: string;
  }): Promise<ReadonlyArray<HuduPassword>> {
    const queryParams: Record<string, string> = { page_size: "50" };
    if (params?.company_id) queryParams.company_id = String(params.company_id);
    if (params?.name) queryParams.name = params.name;

    const result = await this.request<{ asset_passwords: HuduPassword[] }>(
      "/asset_passwords",
      queryParams,
    );
    return result.asset_passwords ?? [];
  }

  // ── Procedures (Processes) ───────────────────────────────────────

  async getProcedures(companyId?: number): Promise<ReadonlyArray<HuduProcedure>> {
    const params: Record<string, string> = { page_size: "50" };
    if (companyId) params.company_id = String(companyId);

    const result = await this.request<{ procedures: HuduProcedure[] }>(
      "/procedures",
      params,
    );
    return result.procedures ?? [];
  }

  // ── Relations (linked items) ─────────────────────────────────────

  async getRelations(params?: {
    readonly asset_id?: number;
  }): Promise<ReadonlyArray<HuduRelation>> {
    const queryParams: Record<string, string> = {};
    if (params?.asset_id) queryParams.asset_id = String(params.asset_id);

    const result = await this.request<{ relations: HuduRelation[] }>(
      "/relations",
      queryParams,
    );
    return result.relations ?? [];
  }
}

// ── Hudu Types ───────────────────────────────────────────────────────

export interface HuduCompany {
  readonly id: number;
  readonly name: string;
  readonly nickname?: string;
  readonly address_line_1?: string;
  readonly city?: string;
  readonly state?: string;
  readonly phone_number?: string;
  readonly website?: string;
  readonly notes?: string;
  readonly archived?: boolean;
  readonly [key: string]: unknown;
}

export interface HuduArticle {
  readonly id: number;
  readonly name: string;
  readonly content?: string;
  readonly company_id?: number;
  readonly company_name?: string;
  readonly folder_id?: number;
  readonly folder_name?: string;
  readonly enable_sharing?: boolean;
  readonly slug?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly [key: string]: unknown;
}

export interface HuduAsset {
  readonly id: number;
  readonly name: string;
  readonly company_id?: number;
  readonly company_name?: string;
  readonly asset_layout_id?: number;
  readonly primary_serial?: string;
  readonly primary_model?: string;
  readonly primary_manufacturer?: string;
  readonly primary_mail?: string;
  readonly archived?: boolean;
  readonly url?: string;
  readonly fields?: ReadonlyArray<HuduAssetField>;
  readonly cards?: ReadonlyArray<HuduAssetCard>;
  readonly [key: string]: unknown;
}

export interface HuduAssetField {
  readonly id?: number;
  readonly label: string;
  readonly value: string | number | boolean | null;
  readonly [key: string]: unknown;
}

export interface HuduAssetCard {
  readonly id?: number;
  readonly integrator_name?: string;
  readonly integrator_id?: number;
  readonly data?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface HuduAssetLayout {
  readonly id: number;
  readonly name: string;
  readonly icon?: string;
  readonly color?: string;
  readonly active?: boolean;
  readonly fields?: ReadonlyArray<{
    readonly id: number;
    readonly label: string;
    readonly field_type: string;
  }>;
  readonly [key: string]: unknown;
}

export interface HuduPassword {
  readonly id: number;
  readonly name: string;
  readonly company_id?: number;
  readonly company_name?: string;
  readonly username?: string;
  readonly description?: string;
  readonly password_type?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

export interface HuduProcedure {
  readonly id: number;
  readonly name: string;
  readonly company_id?: number;
  readonly description?: string;
  readonly content?: string;
  readonly [key: string]: unknown;
}

export interface HuduRelation {
  readonly id: number;
  readonly fromable_type?: string;
  readonly fromable_id?: number;
  readonly toable_type?: string;
  readonly toable_id?: number;
  readonly description?: string;
  readonly [key: string]: unknown;
}
