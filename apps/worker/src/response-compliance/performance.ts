import { isHelpdeskTechnicianName } from "@triageit/shared";
import { responseBusinessMinutesBetween } from "./business-time.js";

export interface TechnicianResponsePerformanceRow {
  readonly assigned_tech: string | null;
  readonly assigned_at: string | null;
  readonly ticket_created_at: string;
  readonly technician_response_at: string | null;
  readonly technician_response_met: boolean | null;
}

export interface TechnicianEmailMetric {
  readonly tech: string;
  readonly measured: number;
  readonly onTime: number;
  readonly missed: number;
  readonly onTimePercent: number;
  readonly medianEmailMinutes: number | null;
  readonly noEmail: number;
}

export interface TechnicianEmailPerformance {
  readonly periodDays: number;
  readonly targetMinutes: number;
  readonly schedule: "Monday-Friday, 8:00 AM-5:00 PM Eastern";
  readonly team: Omit<TechnicianEmailMetric, "tech">;
  readonly technicians: ReadonlyArray<TechnicianEmailMetric>;
}

interface MutableMetric {
  measured: number;
  onTime: number;
  missed: number;
  noEmail: number;
  emailMinutes: number[];
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : Math.round((left + right) / 2);
}

function finalize(tech: string, metric: MutableMetric): TechnicianEmailMetric {
  return {
    tech,
    measured: metric.measured,
    onTime: metric.onTime,
    missed: metric.missed,
    onTimePercent: metric.measured > 0 ? Math.round((metric.onTime / metric.measured) * 100) : 0,
    medianEmailMinutes: median(metric.emailMinutes),
    noEmail: metric.noEmail,
  };
}

/**
 * Build the dashboard's strict email-response metric. Only completed compliance
 * outcomes are measured. Phone calls, voicemail, internal notes, Teams events,
 * and AI notes never populate technician_response_at and therefore never count
 * as a qualifying response.
 */
export function buildTechnicianEmailPerformance(
  rows: ReadonlyArray<TechnicianResponsePerformanceRow>,
  now: Date = new Date(),
  periodDays = 7,
  targetMinutes = 60,
): TechnicianEmailPerformance {
  const cutoff = now.getTime() - periodDays * 24 * 60 * 60_000;
  const byTech = new Map<string, MutableMetric>();
  const team: MutableMetric = { measured: 0, onTime: 0, missed: 0, noEmail: 0, emailMinutes: [] };

  for (const row of rows) {
    const tech = row.assigned_tech?.trim() ?? "";
    const createdAt = Date.parse(row.ticket_created_at);
    if (!isHelpdeskTechnicianName(tech) || !Number.isFinite(createdAt) || createdAt < cutoff) continue;
    if (row.technician_response_met === null || !row.assigned_at) continue;

    const emailMinutes = row.technician_response_at
      ? responseBusinessMinutesBetween(new Date(row.assigned_at), new Date(row.technician_response_at))
      : null;
    const onTime = emailMinutes !== null && emailMinutes <= targetMinutes;
    const metric = byTech.get(tech) ?? { measured: 0, onTime: 0, missed: 0, noEmail: 0, emailMinutes: [] };
    for (const target of [metric, team]) {
      target.measured++;
      if (onTime) target.onTime++;
      else target.missed++;
      if (emailMinutes === null) {
        target.noEmail++;
      } else {
        target.emailMinutes.push(emailMinutes);
      }
    }
    byTech.set(tech, metric);
  }

  const teamMetric = finalize("Team", team);
  const technicians = [...byTech.entries()]
    .map(([tech, metric]) => finalize(tech, metric))
    .sort((left, right) =>
      right.onTimePercent - left.onTimePercent
      || right.measured - left.measured
      || left.tech.localeCompare(right.tech),
    );

  return {
    periodDays,
    targetMinutes,
    schedule: "Monday-Friday, 8:00 AM-5:00 PM Eastern",
    team: {
      measured: teamMetric.measured,
      onTime: teamMetric.onTime,
      missed: teamMetric.missed,
      onTimePercent: teamMetric.onTimePercent,
      medianEmailMinutes: teamMetric.medianEmailMinutes,
      noEmail: teamMetric.noEmail,
    },
    technicians,
  };
}
