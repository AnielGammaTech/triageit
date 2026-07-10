import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api/require-auth";

/**
 * GET /api/halo-agents
 *
 * Lists every agent from Halo with their job title + team, so the roster
 * (who is a tech vs an account manager vs management) comes from Halo's own
 * data instead of a hardcoded guess — the fix for TriageIt mis-tagging an
 * account manager as a help-desk tech and posting a needless reassign note.
 */

interface HaloAgentRaw {
  readonly id?: number;
  readonly name?: string;
  readonly jobtitle?: string;
  readonly team?: string;
  readonly initials?: string;
  readonly isdisabled?: boolean;
  readonly email?: string;
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

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

  // Auth — resolve the token endpoint from authinfo (falls back to /auth/token)
  let tokenUrl = `${config.base_url}/auth/token`;
  try {
    const infoRes = await fetch(`${config.base_url}/api/authinfo`);
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { token_endpoint?: string; auth_url?: string };
      if (info.token_endpoint) tokenUrl = info.token_endpoint;
      else if (info.auth_url) tokenUrl = `${info.auth_url}/token`;
    }
  } catch {
    /* fall through to default */
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

  const res = await fetch(`${config.base_url}/api/agent?count=500&includecolumns=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Halo agent lookup failed (${res.status})` }, { status: 502 });
  }
  const raw = await res.json();
  const rows = (Array.isArray(raw) ? raw : (raw.agents ?? [])) as HaloAgentRaw[];

  const agents = rows
    .filter((a) => a.name && a.name.toLowerCase() !== "unassigned")
    .map((a) => ({
      id: a.id ?? null,
      name: a.name ?? "",
      jobTitle: (a.jobtitle ?? "").trim() || null,
      team: (a.team ?? "").trim() || null,
      initials: a.initials ?? null,
      email: a.email ?? null,
      disabled: a.isdisabled === true,
    }))
    .sort((x, y) => {
      if (x.disabled !== y.disabled) return x.disabled ? 1 : -1;
      return x.name.localeCompare(y.name);
    });

  const missingTitle = agents.filter((a) => !a.disabled && !a.jobTitle).length;

  return NextResponse.json({ agents, total: agents.length, missingTitle });
}
