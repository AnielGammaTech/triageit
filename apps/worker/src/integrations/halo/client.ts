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
}
