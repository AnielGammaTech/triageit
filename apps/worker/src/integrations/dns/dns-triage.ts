/**
 * DNS Triage — Free MXToolbox replacement using Google Public DNS API.
 *
 * Runs MX, SPF, DMARC, DKIM, A record, and nameserver checks
 * without requiring any API key or paid service.
 */

const DNS_API = "https://dns.google/resolve";

interface DnsAnswer {
  readonly name: string;
  readonly type: number;
  readonly TTL: number;
  readonly data: string;
}

interface DnsResponse {
  readonly Status: number;
  readonly Answer?: ReadonlyArray<DnsAnswer>;
  readonly Authority?: ReadonlyArray<DnsAnswer>;
}

interface DnsCheck {
  readonly label: string;
  readonly status: "PASS" | "FAIL" | "WARN";
  readonly records?: ReadonlyArray<string>;
  readonly record?: string | null;
  readonly note: string | null;
  readonly [key: string]: unknown;
}

export interface DnsTriageReport {
  readonly domain: string;
  readonly timestamp: string;
  readonly checks: {
    readonly mx: DnsCheck;
    readonly spf: DnsCheck;
    readonly dmarc: DnsCheck & {
      readonly enabled: boolean;
      readonly policy: string | null;
    };
    readonly dkim: DnsCheck;
    readonly aRecord: DnsCheck;
    readonly ns: DnsCheck;
  };
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly warnings: number;
    readonly failedChecks: ReadonlyArray<string>;
    readonly overallStatus: string;
  };
}

async function dnsLookup(name: string, type: string): Promise<ReadonlyArray<DnsAnswer>> {
  try {
    const res = await fetch(
      `${DNS_API}?name=${encodeURIComponent(name)}&type=${type}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as DnsResponse;
    return data.Answer ?? [];
  } catch {
    return [];
  }
}

/**
 * Run a comprehensive DNS triage for a domain.
 * Checks: MX, SPF, DMARC, DKIM (common selectors), A record, nameservers.
 */
export async function runDnsTriage(domain: string): Promise<DnsTriageReport> {
  const timestamp = new Date().toISOString();

  // Run all DNS queries in parallel for speed
  const [mxRecords, txtRecords, dmarcRecords, aRecords, nsRecords, dkimResults] =
    await Promise.all([
      dnsLookup(domain, "MX"),
      dnsLookup(domain, "TXT"),
      dnsLookup(`_dmarc.${domain}`, "TXT"),
      dnsLookup(domain, "A"),
      dnsLookup(domain, "NS"),
      checkDkim(domain),
    ]);

  // ── MX Records ──────────────────────────────────────────────────────
  const mx: DnsCheck = {
    label: "MX Records",
    status: mxRecords.length > 0 ? "PASS" : "FAIL",
    records: mxRecords.map((r) => r.data),
    note:
      mxRecords.length === 0
        ? "No MX records found — domain cannot receive email."
        : null,
  };

  // ── SPF ─────────────────────────────────────────────────────────────
  const spfRecord = txtRecords.find((r) =>
    r.data.replace(/"/g, "").startsWith("v=spf1"),
  );
  const spfData = spfRecord?.data.replace(/"/g, "") ?? null;

  // Count DNS lookups in SPF
  let spfLookupCount = 0;
  let spfNote: string | null = null;
  if (spfData) {
    const lookupMechanisms = spfData.match(
      /\b(include:|a:|mx:|redirect=|exists:)/gi,
    );
    spfLookupCount = lookupMechanisms?.length ?? 0;
    if (spfLookupCount > 10) {
      spfNote = `⚠️ SPF has ${spfLookupCount} DNS lookups (max 10). This will cause SPF permerror.`;
    } else if (spfData.includes("~all")) {
      spfNote =
        "SPF uses softfail (~all). Consider upgrading to hardfail (-all) for production.";
    }
  }

  const spf: DnsCheck = {
    label: "SPF",
    status: spfRecord
      ? spfLookupCount > 10
        ? "WARN"
        : "PASS"
      : "FAIL",
    record: spfData,
    note: spfRecord
      ? spfNote
      : "⚠️ No SPF record found — senders are not authenticated.",
    lookupCount: spfLookupCount,
  };

  // ── DMARC ───────────────────────────────────────────────────────────
  const dmarcRecord = dmarcRecords.find((r) =>
    r.data.replace(/"/g, "").includes("v=DMARC1"),
  );
  const dmarcData = dmarcRecord?.data.replace(/"/g, "") ?? null;
  const dmarcPolicy = dmarcData?.match(/p=(\w+)/)?.[1] ?? null;

  const dmarc: DnsCheck & { enabled: boolean; policy: string | null } = {
    label: "DMARC",
    status: dmarcRecord ? (dmarcPolicy === "none" ? "WARN" : "PASS") : "FAIL",
    enabled: !!dmarcRecord,
    policy: dmarcPolicy,
    record: dmarcData,
    note: !dmarcRecord
      ? "⚠️ DMARC not configured — domain is vulnerable to spoofing."
      : dmarcPolicy === "none"
        ? "⚠️ DMARC is set to p=none — monitoring only, not enforced."
        : `✅ DMARC enforced (p=${dmarcPolicy})`,
  };

  // ── DKIM ────────────────────────────────────────────────────────────
  const dkim: DnsCheck = {
    label: "DKIM",
    status: dkimResults.found ? "PASS" : "WARN",
    records: dkimResults.selectors,
    note: dkimResults.found
      ? `DKIM found for selector(s): ${dkimResults.selectors.join(", ")}`
      : "Could not verify DKIM — unknown selector. This is not necessarily a failure; the correct selector may not be in our check list.",
  };

  // ── A Record ────────────────────────────────────────────────────────
  const aRecord: DnsCheck = {
    label: "A Record (IPv4)",
    status: aRecords.length > 0 ? "PASS" : "FAIL",
    records: aRecords.map((r) => r.data),
    note: aRecords.length === 0 ? "No A record — domain does not resolve." : null,
  };

  // ── NS Records ─────────────────────────────────────────────────────
  const ns: DnsCheck = {
    label: "Nameservers",
    status: nsRecords.length > 0 ? "PASS" : "FAIL",
    records: nsRecords.map((r) => r.data),
    note: null,
  };

  // ── Summary ─────────────────────────────────────────────────────────
  const allChecks = [mx, spf, dmarc, dkim, aRecord, ns];
  const failed = allChecks
    .filter((c) => c.status === "FAIL")
    .map((c) => c.label);
  const warnings = allChecks
    .filter((c) => c.status === "WARN")
    .map((c) => c.label);

  return {
    domain,
    timestamp,
    checks: { mx, spf, dmarc, dkim, aRecord, ns },
    summary: {
      total: allChecks.length,
      passed: allChecks.filter((c) => c.status === "PASS").length,
      failed: failed.length,
      warnings: warnings.length,
      failedChecks: [...failed, ...warnings],
      overallStatus:
        failed.length === 0 && warnings.length === 0
          ? "✅ All checks passed"
          : failed.length > 0
            ? `❌ ${failed.length} failure(s), ${warnings.length} warning(s)`
            : `⚠️ ${warnings.length} warning(s)`,
    },
  };
}

// ── DKIM Selector Check ───────────────────────────────────────────────

const COMMON_DKIM_SELECTORS = [
  "selector1", // Microsoft 365
  "selector2", // Microsoft 365
  "google",    // Google Workspace
  "k1",        // Mailchimp
  "s1",        // Generic
  "s2",        // Generic
  "default",   // Generic
  "dkim",      // Generic
  "mail",      // Generic
  "mandrill",  // Mailchimp/Mandrill
  "smtp",      // Generic SMTP
  "mesmtp",    // Mailgun
];

async function checkDkim(
  domain: string,
): Promise<{ found: boolean; selectors: string[] }> {
  const foundSelectors: string[] = [];

  // Check common selectors in parallel (batches of 4 to avoid rate limiting)
  for (let i = 0; i < COMMON_DKIM_SELECTORS.length; i += 4) {
    const batch = COMMON_DKIM_SELECTORS.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (selector) => {
        // Try both CNAME and TXT
        const [cnameResult, txtResult] = await Promise.all([
          dnsLookup(`${selector}._domainkey.${domain}`, "CNAME"),
          dnsLookup(`${selector}._domainkey.${domain}`, "TXT"),
        ]);
        const hasRecord = cnameResult.length > 0 || txtResult.length > 0;
        return { selector, found: hasRecord };
      }),
    );

    for (const r of results) {
      if (r.found) foundSelectors.push(r.selector);
    }
  }

  return { found: foundSelectors.length > 0, selectors: foundSelectors };
}
