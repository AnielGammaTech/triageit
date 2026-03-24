import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

interface HaloAction {
  readonly id: number;
  readonly note: string;
  readonly outcome: string;
  readonly hiddenfromuser: boolean;
  readonly who?: string;
  readonly datecreated?: string;
}

async function getHaloToken(config: HaloConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.client_id,
    client_secret: config.client_secret,
    scope: "all",
  });
  if (config.tenant) body.set("tenant", config.tenant);

  const response = await fetch(`${config.base_url}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`Halo auth failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const haloId = request.nextUrl.searchParams.get("halo_id");
  if (!haloId) {
    return NextResponse.json({ error: "halo_id is required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  const { data: integration } = await serviceClient
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Halo not configured" }, { status: 400 });
  }

  const config = integration.config as HaloConfig;

  try {
    const token = await getHaloToken(config);
    const url = `${config.base_url}/api/actions?ticket_id=${haloId}&excludesys=true`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Halo API error: ${response.status}` }, { status: 502 });
    }

    const data = (await response.json()) as { actions?: HaloAction[] };
    const actions = (data.actions ?? [])
      .sort((a, b) => {
        const dateA = a.datecreated ? new Date(a.datecreated).getTime() : 0;
        const dateB = b.datecreated ? new Date(b.datecreated).getTime() : 0;
        return dateB - dateA;
      })
      .map((a) => ({
        who: a.who ?? "Unknown",
        date: a.datecreated ?? "",
        note: stripHtml(a.note),
        isInternal: a.hiddenfromuser,
        outcome: a.outcome ?? null,
      }));

    return NextResponse.json({ actions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
