export const SATURDAY_SUPPORT_OBJECTIVE_PREFIX = "[SATURDAY SUPPORT]";
export const SATURDAY_SUPPORT_ESCALATION_PREFIX = "[SATURDAY SUPPORT ESCALATION]";
export const SATURDAY_SUPPORT_MANAGER_PHONE = "+12396926415";
export const SATURDAY_SUPPORT_RETRY_MS = 5 * 60_000;

export interface SaturdaySupportCallObjective {
  readonly kind: "verification" | "manager_escalation";
  readonly technician: string;
  readonly date: string;
  readonly shift: string;
  readonly attempt: number;
  readonly reason?: string;
}

export function buildSaturdaySupportObjective(
  objective: SaturdaySupportCallObjective,
): string {
  const prefix = objective.kind === "manager_escalation"
    ? SATURDAY_SUPPORT_ESCALATION_PREFIX
    : SATURDAY_SUPPORT_OBJECTIVE_PREFIX;
  return `${prefix} ${JSON.stringify(objective)}`;
}

export function parseSaturdaySupportObjective(
  value: string | null | undefined,
): SaturdaySupportCallObjective | null {
  if (!value) return null;
  const prefix = value.startsWith(SATURDAY_SUPPORT_ESCALATION_PREFIX)
    ? SATURDAY_SUPPORT_ESCALATION_PREFIX
    : value.startsWith(SATURDAY_SUPPORT_OBJECTIVE_PREFIX)
      ? SATURDAY_SUPPORT_OBJECTIVE_PREFIX
      : null;
  if (!prefix) return null;
  try {
    const parsed = JSON.parse(value.slice(prefix.length).trim()) as Partial<SaturdaySupportCallObjective>;
    const kind = prefix === SATURDAY_SUPPORT_ESCALATION_PREFIX
      ? "manager_escalation"
      : "verification";
    if (
      typeof parsed.technician !== "string" ||
      !parsed.technician.trim() ||
      typeof parsed.date !== "string" ||
      typeof parsed.shift !== "string"
    ) {
      return null;
    }
    return {
      kind,
      technician: parsed.technician.trim(),
      date: parsed.date,
      shift: parsed.shift,
      attempt: Math.max(1, Number(parsed.attempt) || 1),
      ...(typeof parsed.reason === "string" && parsed.reason.trim()
        ? { reason: parsed.reason.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saturdaySupportDedupeKey(
  date: string,
  technician: string,
  attempt: number,
): string {
  const slug = technician.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `saturday_support:${date}:${slug || "unknown"}:${attempt}`;
}

export function saturdaySupportEscalationDedupeKey(date: string): string {
  return `saturday_support:${date}:manager_escalation`;
}
