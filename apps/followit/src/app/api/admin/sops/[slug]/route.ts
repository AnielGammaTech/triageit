import { NextResponse } from "next/server";
import { requestHasAdminSession } from "@/lib/admin-auth";
import { normalizeSopInput } from "@/lib/sop-input";
import { deleteSop, getSop, listSops, upsertSop } from "@/lib/sop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SopRouteContext {
  readonly params: Promise<{ readonly slug: string }>;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request, { params }: SopRouteContext) {
  if (!requestHasAdminSession(request)) return unauthorized();
  const { slug } = await params;
  const sop = await getSop(slug);
  if (!sop) return NextResponse.json({ error: "SOP not found" }, { status: 404 });
  return NextResponse.json({ sop });
}

export async function PUT(request: Request, { params }: SopRouteContext) {
  if (!requestHasAdminSession(request)) return unauthorized();
  const { slug } = await params;
  const existing = await getSop(slug);
  if (!existing) return NextResponse.json({ error: "SOP not found" }, { status: 404 });

  const input = (await request.json()) as Record<string, unknown>;
  const updated = normalizeSopInput(input, existing);
  const saved = await upsertSop(updated, slug);
  return NextResponse.json({ sop: saved, sops: await listSops() });
}

export async function DELETE(request: Request, { params }: SopRouteContext) {
  if (!requestHasAdminSession(request)) return unauthorized();
  const { slug } = await params;
  const deleted = await deleteSop(slug);
  if (!deleted) return NextResponse.json({ error: "SOP not found" }, { status: 404 });
  return NextResponse.json({ sops: await listSops() });
}
