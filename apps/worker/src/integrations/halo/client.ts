import type { HaloConfig, HaloTicket, HaloAction, HaloAttachment } from "@triageit/shared";
import { getHaloToken } from "./auth.js";
import { withCache } from "../../cache/integration-cache.js";

/**
 * Represents a downloaded image attachment ready for the vision API.
 */
export interface TicketImage {
  readonly filename: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  readonly base64Data: string;
  readonly actionId: number | null;
  readonly who: string | null;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"]);
const MAX_IMAGES = 5; // Cap to avoid token explosion
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image

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

  async updateTicketStatus(
    ticketId: number,
    statusId: number,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, status_id: statusId },
    ]);
  }

  async assignTicket(
    ticketId: number,
    agentId: number,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, agent_id: agentId },
    ]);
  }

  async addInternalNote(ticketId: number, note: string): Promise<number> {
    const result = await this.request<{ id?: number }>("POST", "/actions", [
      {
        ticket_id: ticketId,
        note,
        outcome: "note",
        hiddenfromuser: true,
      },
    ]);
    return result.id ?? 0;
  }

  async updateNote(actionId: number, ticketId: number, note: string): Promise<void> {
    await this.request("POST", "/actions", [
      {
        id: actionId,
        ticket_id: ticketId,
        note,
        outcome: "note",
        hiddenfromuser: true,
      },
    ]);
  }

  /**
   * Find the most recent TriageIT note of a given type on a ticket.
   * Returns the action ID if found, null otherwise.
   */
  async findTriageItNote(ticketId: number, noteType: string): Promise<number | null> {
    const actions = await this.getTicketActions(ticketId);
    const match = [...actions]
      .filter((a) => {
        const lower = (a.note ?? "").toLowerCase();
        return a.hiddenfromuser && (lower.includes("triageit") || lower.includes("triage it")) && lower.includes(noteType.toLowerCase());
      })
      .sort((a, b) => new Date(a.actiondatecreated ?? a.datetime ?? "").getTime() - new Date(b.actiondatecreated ?? b.datetime ?? "").getTime())
      .pop();
    return match?.id ?? null;
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

  async getOpenTickets(ticketTypeId?: number): Promise<ReadonlyArray<HaloTicket>> {
    // Halo uses `count` (NOT `page_size`) for result limit. `page_size` caps at 50.
    // Use `count=500` to get all open tickets in one request.
    const typeFilter = ticketTypeId ? `&requesttype_id=${ticketTypeId}` : "";
    const closedStatusIds = new Set([9, 10, 24, 26, 27]);

    const result = await this.request<{ tickets: HaloTicket[]; record_count: number }>(
      "GET",
      `/tickets?count=500&open_only=true&order=datecreated&orderdesc=true&includecolumns=true&includeslainfo=true${typeFilter}`,
    );

    const tickets = (result.tickets ?? []).filter((t) => {
      const statusId = (t as unknown as Record<string, unknown>).status_id as number | undefined;
      return !statusId || !closedStatusIds.has(statusId);
    });

    console.log(`[HALO] getOpenTickets: ${tickets.length} open tickets (${result.record_count ?? "?"} from API)${ticketTypeId ? ` (type ${ticketTypeId})` : ""}`);
    return tickets;
  }

  async getTicketWithSLA(ticketId: number): Promise<HaloTicket & { sla_timer_text?: string }> {
    return this.request<HaloTicket & { sla_timer_text?: string }>(
      "GET",
      `/tickets/${ticketId}?includeslainfo=true&includedetails=true&includecolumns=true`,
    );
  }

  async getAgentName(agentId: number): Promise<string | null> {
    return withCache(
      "halo",
      "agent-name",
      async () => {
        try {
          const agent = await this.request<{ name?: string }>(
            "GET",
            `/agent/${agentId}`,
          );
          return agent.name ?? null;
        } catch {
          console.warn(`[HALO] Could not resolve agent name for agent_id=${agentId}`);
          return null;
        }
      },
      86400,
      String(agentId),
    );
  }

  /**
   * Resolve a tech's display name from Halo data. Handles cases where
   * agent_name is missing or is a generic placeholder like "Tech 1".
   */
  async resolveAgentName(agentName: string | null | undefined, agentId: number | null | undefined): Promise<string | null> {
    const name = agentName ?? null;
    const isPlaceholder = name !== null && /^(?:tech\s*)?\d+$/i.test(name.trim());

    if (name && !isPlaceholder) return name;

    if (agentId) {
      const resolved = await this.getAgentName(agentId);
      if (resolved) return resolved;
    }

    // Return the placeholder as-is if we couldn't resolve
    return name;
  }

  /**
   * Search for an agent by name and return their ID.
   * Useful for building Halo @mentions.
   */
  async findAgentByName(name: string): Promise<{ id: number; name: string } | null> {
    return withCache(
      "halo",
      "agent-by-name",
      async () => {
        try {
          const result = await this.request<{ agents?: ReadonlyArray<{ id: number; name: string }> }>(
            "GET",
            `/agent?search=${encodeURIComponent(name)}&count=5`,
          );
          const agents = result.agents ?? [];
          // Exact match first, then partial
          const exact = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
          if (exact) return exact;
          const partial = agents.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
          return partial ?? null;
        } catch {
          console.warn(`[HALO] Could not search for agent "${name}"`);
          return null;
        }
      },
      86400,
      name.toLowerCase(),
    );
  }

  /**
   * Format a Halo @mention tag for use in HTML notes.
   * Halo uses a specific HTML format to trigger notifications.
   */
  static formatMention(agentId: number, agentName: string): string {
    return `<span class="atwho-inserted" data-atwho-at="@"><span class="agent-tag" data-agent-id="${agentId}">@${agentName}</span></span>`;
  }

  /**
   * Look up agent by name and return a formatted @mention.
   * Falls back to plain text "@Name" if agent not found.
   */
  async buildMention(name: string): Promise<string> {
    const agent = await this.findAgentByName(name);
    if (agent) return HaloClient.formatMention(agent.id, agent.name);
    return `@${name}`;
  }

  async updateCustomFields(
    ticketId: number,
    fields: ReadonlyArray<{ id: number; value: string }>,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, customfields: fields },
    ]);
  }

  async updateTicketCustomField(
    ticketId: number,
    fieldName: string,
    value: string,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      {
        id: ticketId,
        customfields: [{ name: fieldName, value }],
      },
    ]);
  }

  /**
   * Update the ticket type in Halo (e.g. move an alert ticket to "Alerts" type).
   */
  async updateTicketType(
    ticketId: number,
    ticketTypeId: number,
  ): Promise<void> {
    await this.request("POST", "/tickets", [
      { id: ticketId, tickettype_id: ticketTypeId },
    ]);
  }

  /**
   * Look up all ticket types from Halo and return as id→name map.
   */
  async getTicketTypes(): Promise<ReadonlyMap<string, number>> {
    // Cache returns a plain object (JSON-serialized Map loses its type),
    // so we cache the entries array and reconstruct the Map.
    const entries = await withCache(
      "halo",
      "ticket-types",
      async () => {
        const result = await this.request<{ record_count?: number } & Record<string, unknown>>(
          "GET",
          "/tickettype?count=100",
        );
        // Halo may return array or { tickettypes: [...] }
        const types: ReadonlyArray<{ id: number; name: string }> =
          Array.isArray(result)
            ? result
            : ((result as Record<string, unknown>).tickettypes as ReadonlyArray<{ id: number; name: string }>) ??
              ((result as Record<string, unknown>).records as ReadonlyArray<{ id: number; name: string }>) ??
              [];
        const pairs: ReadonlyArray<[string, number]> = types
          .filter((t) => t.id && t.name)
          .map((t) => [t.name.toLowerCase(), t.id]);
        return pairs;
      },
      21600,
    );
    return new Map(entries);
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
    return withCache(
      "halo",
      "asset-types",
      async () => {
        const result = await this.request<{ asset_types: HaloAssetType[] }>(
          "GET",
          "/assettype",
        );
        return result.asset_types ?? [];
      },
      21600,
    );
  }

  async getClientAssets(clientId: number): Promise<ReadonlyArray<HaloAsset>> {
    return this.getAssets({ client_id: clientId });
  }

  // ── Attachment / Image Methods ──────────────────────────────────────

  /**
   * Get all attachments for a ticket.
   * Halo returns attachments as part of actions, or via the /attachment endpoint.
   */
  async getTicketAttachments(ticketId: number): Promise<ReadonlyArray<HaloAttachment>> {
    try {
      const result = await this.request<ReadonlyArray<HaloAttachment>>(
        "GET",
        `/attachment?ticket_id=${ticketId}`,
      );
      return result ?? [];
    } catch {
      // Some Halo instances may not support this endpoint
      return [];
    }
  }

  /**
   * Download an attachment by ID and return the raw binary data.
   */
  async downloadAttachment(attachmentId: number): Promise<ArrayBuffer | null> {
    try {
      const token = await getHaloToken(this.config);
      const url = `${this.config.base_url}/api/attachment/${attachmentId}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) return null;
      return response.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * Fetch all image attachments for a ticket, download them,
   * and return as base64-encoded data ready for the Anthropic vision API.
   * Caps at MAX_IMAGES to avoid token explosion.
   */
  async getTicketImages(
    ticketId: number,
    actions?: ReadonlyArray<HaloAction>,
  ): Promise<ReadonlyArray<TicketImage>> {
    const images: TicketImage[] = [];

    // Strategy 1: Extract images from action attachments
    if (actions) {
      for (const action of actions) {
        if (images.length >= MAX_IMAGES) break;
        if (!action.attachments) continue;

        for (const att of action.attachments) {
          if (images.length >= MAX_IMAGES) break;
          if (!isImageAttachment(att.filename)) continue;

          const data = await this.downloadAttachment(att.id);
          if (!data || data.byteLength > MAX_IMAGE_SIZE_BYTES) continue;

          const base64 = Buffer.from(data).toString("base64");
          images.push({
            filename: att.filename,
            mediaType: getMediaType(att.filename),
            base64Data: base64,
            actionId: action.id,
            who: action.who ?? null,
          });
        }
      }
    }

    // Strategy 2: Fall back to ticket-level attachments endpoint
    if (images.length === 0) {
      try {
        const attachments = await this.getTicketAttachments(ticketId);
        const imageAttachments = attachments.filter((a) => isImageAttachment(a.filename));

        for (const att of imageAttachments.slice(0, MAX_IMAGES)) {
          const data = await this.downloadAttachment(att.id);
          if (!data || data.byteLength > MAX_IMAGE_SIZE_BYTES) continue;

          const base64 = Buffer.from(data).toString("base64");
          images.push({
            filename: att.filename,
            mediaType: getMediaType(att.filename),
            base64Data: base64,
            actionId: att.action_id ?? null,
            who: null,
          });
        }
      } catch {
        // Non-critical — images are supplementary
      }
    }

    return images;
  }

  /**
   * Also extract inline images from action HTML notes.
   * Halo sometimes embeds images as <img src="data:..."> or <img src="/api/attachment/123">.
   */
  async extractInlineImages(
    actions: ReadonlyArray<HaloAction>,
  ): Promise<ReadonlyArray<TicketImage>> {
    const images: TicketImage[] = [];

    for (const action of actions) {
      if (images.length >= MAX_IMAGES) break;

      // Match Halo attachment URLs: /api/attachment/123 or full URLs
      const attachmentUrlPattern = /(?:src=["'])(?:https?:\/\/[^"']*)?\/api\/attachment\/(\d+)["']/gi;
      let match: RegExpExecArray | null;

      while ((match = attachmentUrlPattern.exec(action.note)) !== null) {
        if (images.length >= MAX_IMAGES) break;

        const attachmentId = parseInt(match[1], 10);
        if (isNaN(attachmentId)) continue;

        const data = await this.downloadAttachment(attachmentId);
        if (!data || data.byteLength > MAX_IMAGE_SIZE_BYTES) continue;

        const base64 = Buffer.from(data).toString("base64");
        images.push({
          filename: `inline-${attachmentId}.png`,
          mediaType: "image/png",
          base64Data: base64,
          actionId: action.id,
          who: action.who ?? null,
        });
      }

      // Match base64 embedded images: data:image/png;base64,...
      const base64Pattern = /src=["']data:(image\/(?:png|jpeg|gif|webp));base64,([^"']+)["']/gi;
      while ((match = base64Pattern.exec(action.note)) !== null) {
        if (images.length >= MAX_IMAGES) break;

        const mediaType = match[1] as TicketImage["mediaType"];
        const base64 = match[2];

        // Skip tiny images (likely icons/spacers)
        if (base64.length < 500) continue;

        images.push({
          filename: `embedded-${images.length}.${mediaType.split("/")[1]}`,
          mediaType,
          base64Data: base64,
          actionId: action.id,
          who: action.who ?? null,
        });
      }
    }

    return images;
  }
}

// ── Image Helpers ────────────────────────────────────────────────────

function isImageAttachment(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function getMediaType(filename: string): TicketImage["mediaType"] {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg":
    default: return "image/jpeg";
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
