/**
 * Manually queue an SLA escalation call: inserts the request row and
 * enqueues the /sla-call-requests job so the DEPLOYED worker (which owns
 * the voice listener) places the call.
 * Usage: railway run -s worker -- npx tsx scripts/trigger-sla-call.ts <haloId> <phone>
 */
import { Queue } from "bullmq";
import { createSupabaseClient } from "../src/db/supabase.js";
import { getRedisConnectionOptions } from "../src/queue/connection.js";

const haloId = Number(process.argv[2]);
const phone = String(process.argv[3] ?? "");
if (!Number.isFinite(haloId) || !phone) {
  console.error("Usage: trigger-sla-call.ts <haloId> <phone>");
  process.exit(1);
}

const supabase = createSupabaseClient();
const { error } = await supabase.from("sla_call_requests").insert({ halo_id: haloId, phone });
if (error) throw new Error(error.message);

const queue = new Queue("cron-jobs", { connection: getRedisConnectionOptions() });
await queue.add("manual-sla-call", { endpoint: "/sla-call-requests", name: "SLA Escalation Call" });
await queue.close();
console.log(`Queued escalation call: #${haloId} -> ${phone}`);
process.exit(0);
