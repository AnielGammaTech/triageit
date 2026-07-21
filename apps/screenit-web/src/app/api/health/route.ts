import { NextResponse } from "next/server";
import { hasScreenItDatabase } from "@/lib/supabase";
import { getAiConfiguration } from "@/lib/ai-status";

export function GET() {
  return NextResponse.json({ ok: true, service: "screenit-web", database: hasScreenItDatabase() ? "configured" : "demo", ai: getAiConfiguration().configured ? "configured" : "missing", timestamp: new Date().toISOString() });
}
