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
const target = String(process.argv[3] ?? "");
const objective = process.argv[4] ? String(process.argv[4]) : null;
if (!Number.isFinite(haloId) || !target) {
  console.error("Usage: trigger-sla-call.ts <haloId> <phone-or-tech-name> [objective]");
  process.exit(1);
}
const isPhone = /^\+?[\d\s()-]+$/.test(target);

const supabase = createSupabaseClient();
const { error } = await supabase.from("sla_call_requests").insert({
  halo_id: haloId,
  phone: isPhone ? target : null,
  tech_name: isPhone ? null : target,
  objective,
});
if (error) throw new Error(error.message);

const queue = new Queue("cron-jobs", { connection: getRedisConnectionOptions() });
await queue.add("manual-sla-call", { endpoint: "/sla-call-requests", name: "SLA Escalation Call" });
await queue.close();
console.log(`Queued escalation call: #${haloId} -> ${target}`);
process.exit(0);
