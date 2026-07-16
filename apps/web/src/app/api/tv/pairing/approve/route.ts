import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api/require-admin";
import { readJsonBody } from "@/lib/api/json-body";
import { hashTvPairingSecret, isValidTvPairingSecret } from "@/lib/api/tv-key";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ApprovalBody {
  readonly requestId?: string;
  readonly secret?: string;
  readonly trustNetwork?: boolean;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const parsed = await readJsonBody<ApprovalBody>(request, 4096);
  if (!parsed.ok) return parsed.response;
  const requestId = parsed.data?.requestId || "";
  const secret = parsed.data?.secret || "";
  if (!UUID_PATTERN.test(requestId) || !isValidTvPairingSecret(secret)) {
    return NextResponse.json({ error: "Invalid TV pairing request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await auth.serviceClient
    .from("tv_pairing_requests")
    .update({ approved_at: now, approved_by: auth.user.id })
    .eq("id", requestId)
    .eq("secret_hash", hashTvPairingSecret(secret))
    .is("approved_at", null)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("id, requested_ip")
    .maybeSingle();

  if (error) {
    console.error("[tv-pairing-approve] Failed to approve pairing", error.code);
    return NextResponse.json({ error: "TV pairing approval failed" }, { status: 503 });
  }
  if (!data) {
    return NextResponse.json({ error: "This TV pairing request is invalid, expired, or already approved" }, { status: 409 });
  }

  let trustedNetwork = false;
  if (parsed.data?.trustNetwork !== false && data.requested_ip) {
    const { error: trustError } = await auth.serviceClient
      .from("tv_trusted_ips")
      .upsert({
        ip_address: data.requested_ip,
        label: "Office TV network",
        created_by: auth.user.id,
      }, { onConflict: "ip_address" });
    if (trustError) {
      console.warn("[tv-pairing-approve] TV approved but network trust failed", trustError.code);
    } else {
      trustedNetwork = true;
    }
  }

  return NextResponse.json({ ok: true, trustedNetwork }, { headers: { "Cache-Control": "private, no-store" } });
}
