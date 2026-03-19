import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./connection.js";

const QUEUE_NAME = "triage";

let queue: Queue | null = null;

export function getTriageQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export interface TriageJobData {
  readonly ticketId: string;
  readonly haloId: number;
  readonly summary: string;
}

export async function enqueueTriageJob(data: TriageJobData): Promise<string> {
  const triageQueue = getTriageQueue();

  // Remove any existing job for this ticket so re-triages always work.
  // BullMQ silently ignores add() if a job with the same ID already exists.
  try {
    const existingJob = await triageQueue.getJob(`triage-${data.ticketId}`);
    if (existingJob) {
      await existingJob.remove();
      console.log(`[QUEUE] Removed existing job for ticket ${data.ticketId} to allow re-triage`);
    }
  } catch {
    // Non-critical — job may not exist
  }

  const job = await triageQueue.add("triage-ticket", data, {
    jobId: `triage-${data.ticketId}`,
  });
  console.log(`[QUEUE] Enqueued job ${job.id} for ticket #${data.haloId}`);
  return job.id ?? data.ticketId;
}
