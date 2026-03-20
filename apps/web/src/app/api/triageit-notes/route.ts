import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";
import { checkRateLimit } from "@/lib/api/rate-limit";

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

interface HaloAction {
  readonly id: number;
  readonly ticket_id: number;
  readonly note: string;
  readonly outcome: string;
  readonly hiddenfromuser: boolean;
  readonly who?: string;
  readonly datecreated?: string;
}

export interface TriageItNote {
  readonly id: number;
  readonly note: string;
  readonly date: string;
  readonly type: "triage" | "retriage" | "tech-review" | "alert" | "priority" | "documentation" | "other";
}

/**
 * Detect which type of TriageIt note this is based on HTML content.
 */
function classifyNote(html: string): TriageItNote["type"] {
  if (html.includes("Tech Performance Review")) return "tech-review";
  if (html.includes("Retriage Check") || html.includes("Re-Triage")) return "retriage";
  if (html.includes("alert path")) return "alert";
  if (html.includes("Priority Recommendation")) return "priority";
  if (html.includes("Documentation Gap")) return "documentation";
  if (html.includes("AI Triage")) return "triage";
  return "other";
}

/**
 * Check if an action was posted by TriageIt.
 */
function isTriageItNote(action: HaloAction): boolean {
  const note = action.note ?? "";
  // TriageIt notes contain our branding / signature markers
  return (
    note.includes("TriageIt") ||
    note.includes("TriageIt AI") ||
    note.includes("AI Triage") ||
    note.includes("triageit") ||
    // Our HTML table notes always have this gradient
    note.includes("linear-gradient(135deg,#6366f1") ||
    note.includes("linear-gradient(135deg,#4f46e5") ||
    note.includes("linear-gradient(135deg,#059669")
  );
}

async function getHaloToken(config: HaloConfig): Promise<string> {
  const tokenUrl = `${config.base_url}/auth/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });

  if (config.tenant) {
    body.set("tenant", config.tenant);
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Halo auth failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function fetchHaloActions(
  config: HaloConfig,
  ticketId: number,
): Promise<ReadonlyArray<HaloAction>> {
  const token = await getHaloToken(config);
  const url = `${config.base_url}/api/actions?ticket_id=${ticketId}&excludesys=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Halo actions fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as { actions: HaloAction[] };
  return data.actions ?? [];
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rateLimited = checkRateLimit(auth.user.id, 20, 60_000, "triageit-notes");
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as { halo_id?: number };

    if (!body.halo_id) {
      return NextResponse.json(
        { error: "Missing halo_id" },
        { status: 400 },
      );
    }

    const supabase = await createServiceClient();

    const { data: haloIntegration } = await supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .eq("is_active", true)
      .single();

    if (!haloIntegration) {
      return NextResponse.json(
        { error: "Halo integration not configured" },
        { status: 500 },
      );
    }

    const config = haloIntegration.config as HaloConfig;
    const allActions = await fetchHaloActions(config, body.halo_id);

    // Filter to only TriageIt-posted notes
    const triageItNotes: ReadonlyArray<TriageItNote> = allActions
      .filter(isTriageItNote)
      .sort(
        (a, b) =>
          new Date(a.datecreated ?? "").getTime() -
          new Date(b.datecreated ?? "").getTime(),
      )
      .map((a) => ({
        id: a.id,
        note: a.note,
        date: a.datecreated ?? "",
        type: classifyNote(a.note),
      }));

    return NextResponse.json({
      notes: triageItNotes,
      count: triageItNotes.length,
    });
  } catch (err) {
    console.error("[TRIAGEIT-NOTES] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch TriageIt notes" },
      { status: 500 },
    );
  }
}
