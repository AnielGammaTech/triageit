import { NextResponse } from "next/server";
import { requestHasAdminSession } from "@/lib/admin-auth";
import { normalizeSopInput } from "@/lib/sop-input";
import { listSops, upsertSop } from "@/lib/sop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  if (!requestHasAdminSession(request)) return unauthorized();
  return NextResponse.json({ sops: await listSops() });
}

export async function POST(request: Request) {
  if (!requestHasAdminSession(request)) return unauthorized();
  const input = (await request.json()) as Record<string, unknown>;
  const sop = normalizeSopInput(input);
  const saved = await upsertSop(sop);
  return NextResponse.json({ sop: saved, sops: await listSops() }, { status: 201 });
}
