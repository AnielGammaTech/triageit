import type { HaloConfig, HaloTicket, HaloAction } from "@triageit/shared";
import { getHaloToken } from "./auth.js";

export class HaloClient {
  constructor(private readonly config: HaloConfig) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await getHaloToken(this.config);
    const url = `${this.config.base_url}/api${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Halo API ${method} ${path} failed (${response.status}): ${text}`);
    }

    return (await response.json()) as T;
  }

  async getTicket(ticketId: number): Promise<HaloTicket> {
    return this.request<HaloTicket>("GET", `/tickets/${ticketId}`);
  }

  async getTicketActions(ticketId: number): Promise<ReadonlyArray<HaloAction>> {
    const result = await this.request<{ actions: HaloAction[] }>(
      "GET",
      `/actions?ticket_id=${ticketId}&excludesys=true`,
    );
    return result.actions ?? [];
  }

  async updateTicketPriority(
    ticketId: number,
    priorityId: number,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, priority_id: priorityId },
    ]);
  }

  async addInternalNote(ticketId: number, note: string): Promise<void> {
    await this.request("POST", "/actions", [
      {
        ticket_id: ticketId,
        note,
        outcome: "note",
        hiddenfromuser: true,
      },
    ]);
  }

  async addClientNote(ticketId: number, note: string): Promise<void> {
    await this.request("POST", "/actions", [
      {
        ticket_id: ticketId,
        note,
        outcome: "note",
        hiddenfromuser: false,
        sendemail: false,
      },
    ]);
  }

  async updateCustomFields(
    ticketId: number,
    fields: ReadonlyArray<{ id: number; value: string }>,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, customfields: fields },
    ]);
  }

  // ── Asset / Printer Methods ──────────────────────────────────────────

  async getAssets(params?: {
    readonly client_id?: number;
    readonly assettype_id?: number;
    readonly search?: string;
    readonly count?: number;
  }): Promise<ReadonlyArray<HaloAsset>> {
    const query = new URLSearchParams();
    if (params?.client_id) query.set("client_id", String(params.client_id));
    if (params?.assettype_id) query.set("assettype_id", String(params.assettype_id));
    if (params?.search) query.set("search", params.search);
    query.set("count", String(params?.count ?? 100));

    const result = await this.request<{ assets: HaloAsset[] }>(
      "GET",
      `/asset?${query.toString()}`,
    );
    return result.assets ?? [];
  }

  async getAsset(assetId: number): Promise<HaloAsset> {
    return this.request<HaloAsset>("GET", `/asset/${assetId}`);
  }

  async getAssetTypes(): Promise<ReadonlyArray<HaloAssetType>> {
    const result = await this.request<{ asset_types: HaloAssetType[] }>(
      "GET",
      "/assettype",
    );
    return result.asset_types ?? [];
  }

  async getClientAssets(clientId: number): Promise<ReadonlyArray<HaloAsset>> {
    return this.getAssets({ client_id: clientId });
  }
}

// ── Halo Asset Types ──────────────────────────────────────────────────

interface HaloAsset {
  readonly id: number;
  readonly inventory_number?: string;
  readonly client_id?: number;
  readonly client_name?: string;
  readonly site_id?: number;
  readonly site_name?: string;
  readonly assettype_id?: number;
  readonly assettype_name?: string;
  readonly key_field?: string;
  readonly key_field2?: string;
  readonly key_field3?: string;
  readonly status?: string;
  readonly inactive?: boolean;
  readonly fields?: ReadonlyArray<{
    readonly id: number;
    readonly name: string;
    readonly value: string;
  }>;
  readonly [key: string]: unknown;
}

interface HaloAssetType {
  readonly id: number;
  readonly name: string;
  readonly [key: string]: unknown;
}
