"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { TicketList } from "./ticket-list";
import { OpenTicketList } from "./open-ticket-list";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly user_name: string | null;
  readonly original_priority: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly halo_status: string | null;
  readonly halo_team: string | null;
  readonly halo_agent: string | null;
  readonly last_retriage_at: string | null;
  readonly last_customer_reply_at: string | null;
  readonly last_tech_action_at: string | null;
  readonly triage_results: ReadonlyArray<{
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly triage_type?: string;
    readonly classification: {
      readonly type: string;
      readonly subtype: string;
    };
    readonly urgency_reasoning?: string;
    readonly internal_notes?: string;
    readonly created_at?: string;
  }>;
}

interface TicketTabsProps {
  readonly newTickets: ReadonlyArray<TicketRow>;
  readonly openTickets: ReadonlyArray<TicketRow>;
}

export function TicketTabs({ newTickets, openTickets }: TicketTabsProps) {
  const [activeTab, setActiveTab] = useState<"new" | "open">("new");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tickets</h2>
        <div className="flex items-center gap-4">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setActiveTab("new")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "new"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              New Tickets
              <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                {newTickets.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("open")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)]",
                activeTab === "open"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              Open Tickets
              <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
                {openTickets.length}
              </span>
            </button>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {activeTab === "new"
              ? `${newTickets.length} tickets`
              : `${openTickets.length} open`}
          </p>
        </div>
      </div>

      {activeTab === "new" ? (
        <TicketList tickets={newTickets} />
      ) : (
        <OpenTicketList tickets={openTickets} />
      )}
    </div>
  );
}
