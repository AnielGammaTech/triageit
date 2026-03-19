/**
 * WHOIS Lookup via RDAP — the modern, free WHOIS protocol.
 * No API key needed. Works for all major TLDs.
 */

export interface WhoisResult {
  readonly domainName: string;
  readonly registrar: string;
  readonly createdDate: string | null;
  readonly expiresDate: string | null;
  readonly updatedDate: string | null;
  readonly status: ReadonlyArray<string>;
  readonly nameservers: ReadonlyArray<string>;
  readonly daysUntilExpiry: number | null;
  readonly expiryWarning: string | null;
}

// TLD-specific RDAP servers for better reliability
const RDAP_SERVERS: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1",
  net: "https://rdap.verisign.com/net/v1",
  org: "https://rdap.org",
};

const RDAP_FALLBACK = "https://rdap.org";

export async function whoisLookup(domain: string): Promise<WhoisResult | null> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  const baseUrl = RDAP_SERVERS[tld] ?? RDAP_FALLBACK;

  try {
    const res = await fetch(`${baseUrl}/domain/${domain}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // Try fallback if TLD-specific server failed
      if (baseUrl !== RDAP_FALLBACK) {
        const fallbackRes = await fetch(`${RDAP_FALLBACK}/domain/${domain}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!fallbackRes.ok) return null;
        return parseRdapResponse(await fallbackRes.json(), domain);
      }
      return null;
    }

    return parseRdapResponse(await res.json(), domain);
  } catch {
    return null;
  }
}

function parseRdapResponse(data: RdapResponse, domain: string): WhoisResult {
  const registrarEntity = data.entities?.find((e) =>
    e.roles?.includes("registrar"),
  );
  const vcardFields = registrarEntity?.vcardArray?.[1] as
    | ReadonlyArray<ReadonlyArray<unknown>>
    | undefined;
  const registrar =
    vcardFields?.find((v) => v[0] === "fn")?.[3] ?? "N/A";

  const createdDate =
    data.events?.find((e) => e.eventAction === "registration")?.eventDate ??
    null;
  const expiresDate =
    data.events?.find((e) => e.eventAction === "expiration")?.eventDate ?? null;
  const updatedDate =
    data.events?.find(
      (e) =>
        e.eventAction === "last changed" ||
        e.eventAction === "last update of RDAP database",
    )?.eventDate ?? null;

  const nameservers =
    data.nameservers?.map(
      (ns: { ldhName?: string }) => ns.ldhName ?? "",
    ).filter(Boolean) ?? [];

  // Calculate days until expiry
  let daysUntilExpiry: number | null = null;
  let expiryWarning: string | null = null;
  if (expiresDate) {
    const expiryMs =
      new Date(expiresDate).getTime() - Date.now();
    daysUntilExpiry = Math.floor(expiryMs / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      expiryWarning = `🚨 DOMAIN EXPIRED ${Math.abs(daysUntilExpiry)} days ago!`;
    } else if (daysUntilExpiry < 30) {
      expiryWarning = `⚠️ Domain expires in ${daysUntilExpiry} days — RENEW IMMEDIATELY`;
    } else if (daysUntilExpiry < 90) {
      expiryWarning = `⚠️ Domain expires in ${daysUntilExpiry} days — schedule renewal`;
    }
  }

  return {
    domainName: data.ldhName ?? domain,
    registrar: typeof registrar === "string" ? registrar : "N/A",
    createdDate,
    expiresDate,
    updatedDate,
    status: data.status ?? [],
    nameservers,
    daysUntilExpiry,
    expiryWarning,
  };
}

// ── RDAP Types ────────────────────────────────────────────────────────

interface RdapResponse {
  readonly ldhName?: string;
  readonly status?: ReadonlyArray<string>;
  readonly entities?: ReadonlyArray<{
    readonly roles?: ReadonlyArray<string>;
    readonly vcardArray?: ReadonlyArray<unknown>;
    readonly [key: string]: unknown;
  }>;
  readonly events?: ReadonlyArray<{
    readonly eventAction: string;
    readonly eventDate: string;
  }>;
  readonly nameservers?: ReadonlyArray<{
    readonly ldhName?: string;
    readonly [key: string]: unknown;
  }>;
  readonly [key: string]: unknown;
}
