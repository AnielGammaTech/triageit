import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { readJsonBody } from "@/lib/api/json-body";
import { getClientIp } from "@/lib/api/request-context";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TrustedIpBody {
  readonly ipAddress?: string;
  readonly label?: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.serviceClient
    .from("tv_trusted_ips")
    .select("id, ip_address, label, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[tv-trusted-ips] Failed to list trusted IPs", error.code);
    return NextResponse.json({ error: "Trusted IPs are temporarily unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { currentIp: getClientIp(request), trustedIps: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const parsed = await readJsonBody<TrustedIpBody>(request, 2048);
  if (!parsed.ok) return parsed.response;

  const ipAddress = parsed.data?.ipAddress?.trim() || getClientIp(request);
  if (!ipAddress || !isIP(ipAddress)) {
    return NextResponse.json({ error: "A valid public IP address is required" }, { status: 400 });
  }

  const label = parsed.data?.label?.trim().slice(0, 64) || "Office TV network";
  const { data, error } = await auth.serviceClient
    .from("tv_trusted_ips")
    .upsert(
      { ip_address: ipAddress, label, created_by: auth.user.id },
      { onConflict: "ip_address" },
    )
    .select("id, ip_address, label, created_at")
    .single();

  if (error) {
    console.error("[tv-trusted-ips] Failed to trust IP", error.code);
    return NextResponse.json({ error: "Could not trust that IP address" }, { status: 500 });
  }

  return NextResponse.json({ trustedIp: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "A valid trusted-IP ID is required" }, { status: 400 });
  }

  const { error } = await auth.serviceClient.from("tv_trusted_ips").delete().eq("id", id);
  if (error) {
    console.error("[tv-trusted-ips] Failed to remove trusted IP", error.code);
    return NextResponse.json({ error: "Could not remove that trusted IP" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
