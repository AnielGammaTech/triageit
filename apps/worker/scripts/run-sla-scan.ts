import { scanForSlaBreaches } from "../src/cron/sla-scan.js";
const result = await scanForSlaBreaches();
console.log("RESULT:", JSON.stringify(result));
process.exit(0);
