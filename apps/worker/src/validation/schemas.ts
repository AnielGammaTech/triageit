import { z } from "zod";

/**
 * POST /triage
 * Requires at least one of ticket_id (UUID) or halo_id (positive integer).
 */
export const triageSchema = z
  .object({
    ticket_id: z.string().uuid("ticket_id must be a valid UUID").optional(),
    halo_id: z
      .number()
      .int("halo_id must be an integer")
      .positive("halo_id must be a positive integer")
      .optional(),
  })
  .refine((data) => data.ticket_id !== undefined || data.halo_id !== undefined, {
    message: "At least one of ticket_id or halo_id is required",
  });

export type TriageBody = z.infer<typeof triageSchema>;

/**
 * POST /cron/trigger
 * Requires a non-empty job_id string.
 */
export const cronTriggerSchema = z.object({
  job_id: z.string().min(1, "job_id must be a non-empty string"),
});

export type CronTriggerBody = z.infer<typeof cronTriggerSchema>;

/**
 * POST /webhook/action
 * Requires ticket_id (positive integer) and note (non-empty string).
 * Optional: who (string), hiddenfromuser (boolean).
 */
export const webhookActionSchema = z.object({
  ticket_id: z
    .number()
    .int("ticket_id must be an integer")
    .positive("ticket_id must be a positive integer"),
  note: z.string().min(1, "note must be a non-empty string"),
  who: z.string().optional(),
  hiddenfromuser: z.boolean().optional(),
});

export type WebhookActionBody = z.infer<typeof webhookActionSchema>;
