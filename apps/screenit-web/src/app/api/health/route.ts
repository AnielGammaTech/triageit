import { NextResponse } from "next/server";
import { hasScreenItDatabase } from "@/lib/supabase";

export function GET() {
  return NextResponse.json({ ok: true, service: "screenit-web", database: hasScreenItDatabase() ? "configured" : "demo", timestamp: new Date().toISOString() });
}
