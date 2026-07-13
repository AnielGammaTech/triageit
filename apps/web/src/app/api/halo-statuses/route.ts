import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * GET /api/halo-statuses
 *
 * Lists every Halo status with how TriageIt interprets it (open vs closed,
 * the workflow meaning, and any special handling) — so we can confirm the
 * system understands ALL statuses and none are mis-categorized.
 */

interface HaloStatusRaw {
  readonly id?: number;
  readonly name?: string;
  readonly colour?: string;
  readonly sequence?: number;
}

// Statuses TriageIt treats as CLOSED (excluded from the open queue — matches
// getOpenTickets in the worker: Resolved / Closed Order / Closed Item).
const CLOSED_STATUS_IDS = new Set([9, 13, 15]);

// Plain-English meaning + special handling, mirroring deriveWorkflowStatusFromHalo
// and the response/SLA rules. Keyed by lowercased status name substring.
function interpret(name: string): { workflow: string; meaning: string } {
  const s = name.toLowerCase();
  if (s.includes("closed") || s.includes("resolved") || s.includes("cancel") || s.includes("completed"))
    return { workflow: "RESOLVED", meaning: "Resolved/closed — not triaged unless the customer reopens it." };
  if (s.includes("past-due") || s.includes("past due"))
    return { workflow: "PAST_DUE", meaning: "SLA/deadline missed — surfaces on the SLA Hunter and can trigger escalation." };
  if (s.includes("quote"))
    return { workflow: "NEEDS_QUOTE", meaning: "Needs a quote before work proceeds." };
  if (s.includes("part"))
    return { workflow: "WAITING_ON_PARTS", meaning: "Waiting on parts/vendor — tech must still update the customer within 48h." };
  if (s.includes("waiting on customer") || s.includes("with user") || s.includes("awaiting user") || s.includes("on hold") || s.includes("pending vendor"))
    return { workflow: "WAITING_ON_CUSTOMER", meaning: "Waiting on the customer — SLA response clock is paused; excluded from tech response-time alerts." };
  if (s.includes("customer reply") || s.includes("updated"))
    return { workflow: "CUSTOMER_REPLY", meaning: "Customer replied — triggers an immediate re-triage." };
  if (s.includes("in progress") || s.includes("scheduled"))
    return { workflow: "IN_PROGRESS", meaning: "Actively being worked." };
  if (s.includes("new"))
    return { workflow: "NEW", meaning: "New — needs triage and assignment." };
  if (s.includes("triage review"))
    return { workflow: "IN_PROGRESS", meaning: "Flagged for triage-lead review." };
  return { workflow: "OPEN", meaning: "Open — worked normally; no special handling." };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const supabase = await createServiceClient();

  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Halo not configured" }, { status: 503 });
  }

  const config = integration.config as {
    base_url: string;
    client_id: string;
    client_secret: string;
    tenant?: string;
  };

  let tokenUrl = `${config.base_url}/auth/token`;
  try {
    const infoRes = await fetch(`${config.base_url}/api/authinfo`);
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { token_endpoint?: string; auth_url?: string };
      if (info.token_endpoint) tokenUrl = info.token_endpoint;
      else if (info.auth_url) tokenUrl = `${info.auth_url}/token`;
    }
  } catch {
    /* fall through */
  }
  if (config.tenant) tokenUrl += `?tenant=${config.tenant}`;

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: "all",
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: "Halo authentication failed" }, { status: 502 });
  }
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };

  const res = await fetch(`${config.base_url}/api/status?count=500`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Halo status lookup failed (${res.status})` }, { status: 502 });
  }
  const raw = await res.json();
  const rows = (Array.isArray(raw) ? raw : (raw.statuses ?? raw.records ?? [])) as HaloStatusRaw[];

  const statuses = rows
    .filter((s) => typeof s.id === "number" && s.name)
    .map((s) => {
      const closed = CLOSED_STATUS_IDS.has(s.id!);
      const { workflow, meaning } = interpret(s.name!);
      return {
        id: s.id!,
        name: s.name!,
        colour: s.colour && /^#?[0-9a-fA-F]{6}$/.test(s.colour) ? (s.colour.startsWith("#") ? s.colour : `#${s.colour}`) : null,
        sequence: s.sequence ?? null,
        closed,
        workflow: closed ? "RESOLVED" : workflow,
        meaning: closed ? "Resolved/closed — excluded from the open queue, not triaged." : meaning,
      };
    })
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  return NextResponse.json({ statuses, total: statuses.length });
}
