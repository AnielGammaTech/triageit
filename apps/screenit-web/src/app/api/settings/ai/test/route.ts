import { NextResponse } from "next/server";
import { getAiConfiguration, testAiConnection, testVoiceBridge } from "@/lib/ai-status";
import { hasScreenItDatabase } from "@/lib/supabase";

export async function POST() {
  return NextResponse.json({
    configuration: getAiConfiguration(),
    connection: await testAiConnection(),
    voiceBridge: await testVoiceBridge(),
    database: hasScreenItDatabase() ? "connected" : "demo",
  });
}
