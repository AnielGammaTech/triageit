/**
 * Vendor status checker — public Statuspage v2 JSON APIs, no keys needed.
 * Lets Michael say "the vendor is reporting an incident right now" instead
 * of sending a tech down a debugging rabbit hole during a platform outage.
 *
 * Only vendors with VERIFIED working /api/v2/status.json endpoints are
 * listed (probed 2026-07-08). 3CX, Vultr, Halo, Hudu, and N-able either
 * have no Statuspage or a broken one — Microsoft 365 health comes from
 * CIPP's ListServiceHealth instead (see CippClient.getServiceHealth).
 *
 * Accuracy contract: a vendor appears in the result ONLY when its status
 * page answered. Fetch failures are skipped entirely — never reported as
 * "operational".
 */

interface StatuspageStatus {
  readonly status?: { readonly indicator?: string; readonly description?: string };
}

interface StatuspageIncidents {
  readonly incidents?: ReadonlyArray<{ readonly name?: string; readonly impact?: string }>;
}

export interface VendorStatus {
  readonly vendor: string;
  /** none | minor | major | critical (Statuspage indicator) */
  readonly indicator: string;
  readonly description: string;
  readonly incidents: ReadonlyArray<string>;
}

const VENDOR_PAGES: Record<string, { name: string; base: string }> = {
  kaseya: { name: "Kaseya (Datto RMM/EDR/SaaS Protection)", base: "https://status.kaseya.com" },
  pax8: { name: "Pax8", base: "https://status.pax8.com" },
  jumpcloud: { name: "JumpCloud", base: "https://status.jumpcloud.com" },
  twilio: { name: "Twilio", base: "https://status.twilio.com" },
  ubiquiti: { name: "Ubiquiti (UniFi)", base: "https://status.ui.com" },
};

/** Which vendors matter for each Ryan classification type. */
const TYPE_TO_VENDORS: Record<string, ReadonlyArray<string>> = {
  voip: ["twilio"],
  network: ["ubiquiti"],
  backup: ["kaseya"],
  endpoint: ["kaseya"],
  security: ["kaseya"],
  billing: ["pax8"],
  identity: ["jumpcloud"],
};

async function fetchVendorStatus(key: string): Promise<VendorStatus | null> {
  const page = VENDOR_PAGES[key];
  if (!page) return null;

  try {
    const statusRes = await fetch(`${page.base}/api/v2/status.json`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!statusRes.ok) return null;
    const status = (await statusRes.json()) as StatuspageStatus;
    const indicator = status.status?.indicator ?? "unknown";
    const description = status.status?.description ?? "unknown";

    let incidents: string[] = [];
    if (indicator !== "none") {
      try {
        const incRes = await fetch(`${page.base}/api/v2/incidents/unresolved.json`, {
          signal: AbortSignal.timeout(6_000),
        });
        if (incRes.ok) {
          const inc = (await incRes.json()) as StatuspageIncidents;
          incidents = (inc.incidents ?? [])
            .slice(0, 3)
            .map((i) => `${i.name ?? "Unnamed incident"}${i.impact ? ` [${i.impact}]` : ""}`);
        }
      } catch {
        // Incident detail is best-effort; the indicator alone is useful
      }
    }

    return { vendor: page.name, indicator, description, incidents };
  } catch (error) {
    console.warn(`[VENDOR-STATUS] ${page.name} fetch failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Check the status pages relevant to a ticket's classification type.
 * Returns one entry per vendor that ANSWERED (failures are omitted).
 */
export async function getVendorStatusForType(
  classificationType: string | null | undefined,
): Promise<ReadonlyArray<VendorStatus>> {
  const keys = TYPE_TO_VENDORS[(classificationType ?? "").toLowerCase()] ?? [];
  if (keys.length === 0) return [];

  const results = await Promise.all(keys.map((k) => fetchVendorStatus(k)));
  return results.filter((r): r is VendorStatus => r !== null);
}

/** Format vendor status lines for prompt injection. Empty array → "". */
export function formatVendorStatus(statuses: ReadonlyArray<VendorStatus>): string {
  if (statuses.length === 0) return "";

  const lines: string[] = ["## Vendor Platform Status (live status pages — REAL data)"];
  for (const s of statuses) {
    if (s.indicator === "none") {
      lines.push(`- ${s.vendor}: all systems operational`);
    } else {
      lines.push(`- ⚠ ${s.vendor}: ${s.indicator.toUpperCase()} — ${s.description}`);
      for (const inc of s.incidents) lines.push(`  - Active incident: ${inc}`);
    }
  }
  const anyIncident = statuses.some((s) => s.indicator !== "none");
  if (anyIncident) {
    lines.push(
      "If the customer's symptoms match an active vendor incident, say so in the summary — the tech should NOT deep-debug a platform-side outage. Cite the incident.",
    );
  }
  return lines.join("\n");
}
