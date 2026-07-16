export type AlertManagerDecision = "auto_close" | "keep_open" | "review_required";

export interface AlertTicketInput {
  readonly summary: string;
  readonly details: string | null | undefined;
  readonly userName?: string | null;
}

export interface AlertPolicyDecision {
  readonly decision: AlertManagerDecision;
  readonly confidence: number;
  readonly reason: string;
  readonly source: string;
  readonly alertType: string;
  readonly affectedResource: string | null;
  readonly patternKey: string;
  readonly policySource: "deterministic" | "ai";
}

const SECURITY_SIGNAL = /\b(?:security alert|identity protection|risky sign-?in|malware|ransomware|compromis(?:e|ed)|dark web|credential|phish(?:ing|911)?|intrusion|threat|quarantine|account creation|user created|risky user|sentinel|crowdstrike|huntress|rocket\s?cyber|managed soc|mitre|unauthori[sz]ed)\b/i;
const PERSISTENT_OR_ACTIONABLE = /\b(?:backupiq|scheduled backup failed|no mailbox|does not have an exchange online mailbox|remove the license|backup did not (?:process|complete)|unsuccessful backup|no successful backup|more than 48 hours|device offline|service down|disk space|certificate expir|forbidden \(403\)|trunk.*failed|registration.*failed|undeliverable)\b/i;
const MISSED_COMMUNICATION = /\b(?:new missed call|new voicemail|voice mail)\b/i;

function text(input: AlertTicketInput): string {
  return `${input.summary}\n${input.details ?? ""}\n${input.userName ?? ""}`;
}

function spanningFields(value: string): { code: string | null; resource: string | null } {
  const code = value.match(/Error Code:\s*(\d+)/i)?.[1] ?? null;
  const resource = value.match(/Error User, Site, or Teams Channel:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null;
  return { code, resource };
}

export function hasProtectedAlertSignals(input: AlertTicketInput): boolean {
  const value = text(input);
  return SECURITY_SIGNAL.test(value) || PERSISTENT_OR_ACTIONABLE.test(value) || MISSED_COMMUNICATION.test(value);
}

/**
 * Recurring 3CX system alerts use an exact summary that includes the PBX FQDN
 * and alert class. Calls/voicemails are deliberately excluded because each is
 * a separate customer-contact event, even when their summaries repeat.
 */
export function recurringThreeCxAlertKey(input: Pick<AlertTicketInput, "summary">): string | null {
  const summary = input.summary.replace(/\s+/g, " ").trim();
  if (!/^3CX\s+(?:Alert|Notification):/i.test(summary)) return null;
  if (/\b(?:missed call|voicemail)\b/i.test(summary)) return null;
  return `3cx:${summary.toLowerCase()}`;
}

export function deterministicAlertDecision(input: AlertTicketInput): AlertPolicyDecision | null {
  const value = text(input);
  if (SECURITY_SIGNAL.test(value)) {
    return {
      decision: "review_required",
      confidence: 1,
      reason: "Security-related alerts are never auto-closed; a person must verify the detection and response.",
      source: "Security monitoring",
      alertType: "security_detection",
      affectedResource: null,
      patternKey: "security:human_review",
      policySource: "deterministic",
    };
  }
  if (MISSED_COMMUNICATION.test(value)) {
    return {
      decision: "review_required",
      confidence: 1,
      reason: "Missed calls and voicemails may represent a customer request and require communication review.",
      source: "3CX",
      alertType: "missed_communication",
      affectedResource: null,
      patternKey: "3cx:missed_communication",
      policySource: "deterministic",
    };
  }
  if (/\bReport[- ]ID:|DMARC aggregate report|noreply-dmarc-support/i.test(value)) {
    return {
      decision: "auto_close",
      confidence: 0.99,
      reason: "Routine DMARC aggregate report; the message is informational and does not describe a delivery or security failure.",
      source: "DMARC",
      alertType: "aggregate_report",
      affectedResource: input.summary.match(/Report domain:\s*([^\s]+)/i)?.[1] ?? null,
      patternKey: "dmarc:aggregate_report",
      policySource: "deterministic",
    };
  }
  if (/3CX:\s*Your Scheduled Reports are ready/i.test(value)) {
    return {
      decision: "auto_close",
      confidence: 0.99,
      reason: "Scheduled 3CX report delivery confirmation; no failure or action request is present.",
      source: "3CX",
      alertType: "scheduled_report_ready",
      affectedResource: null,
      patternKey: "3cx:scheduled_report_ready",
      policySource: "deterministic",
    };
  }
  if (/updates? to .*terms of service|terms of service.*(?:changing|update)/i.test(value)) {
    return {
      decision: "auto_close",
      confidence: 0.98,
      reason: "Vendor terms-of-service announcement with no operational incident or requested action for the help desk.",
      source: "Vendor notification",
      alertType: "terms_update",
      affectedResource: null,
      patternKey: "vendor:terms_update",
      policySource: "deterministic",
    };
  }

  if (/Spanning Backup for Office 365 - Error/i.test(value)) {
    const fields = spanningFields(value);
    const transientCodes = new Set(["10001", "10005", "10022", "14005", "14021"]);
    if (fields.code && transientCodes.has(fields.code)) {
      return {
        decision: "auto_close",
        confidence: 0.98,
        reason: fields.code === "10005"
          ? "Spanning reports a username-change sync condition that clears on the next tenant sync."
          : `Spanning error ${fields.code} is explicitly described as transient Microsoft throttling/server behavior that normally self-resolves.`,
        source: "Spanning",
        alertType: `transient_error_${fields.code}`,
        affectedResource: fields.resource,
        patternKey: `spanning:${fields.code}`,
        policySource: "deterministic",
      };
    }
    if (fields.code) {
      return {
        decision: "review_required",
        confidence: 0.99,
        reason: `Spanning error ${fields.code} is not on the verified self-resolving allowlist and may require configuration or data-protection work.`,
        source: "Spanning",
        alertType: `error_${fields.code}`,
        affectedResource: fields.resource,
        patternKey: `spanning:${fields.code}`,
        policySource: "deterministic",
      };
    }
  }
  if (PERSISTENT_OR_ACTIONABLE.test(value)) {
    return {
      decision: "keep_open",
      confidence: 0.99,
      reason: "The alert describes a persistent service, backup, configuration, or delivery problem that requires verification or remediation.",
      source: "Monitoring",
      alertType: "actionable_failure",
      affectedResource: null,
      patternKey: "monitoring:actionable_failure",
      policySource: "deterministic",
    };
  }
  return null;
}
