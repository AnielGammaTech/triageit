import type { MxToolboxConfig } from "@triageit/shared";

/**
 * MxToolboxClient — Queries MX Toolbox API for email/DNS diagnostics.
 *
 * Used by Phyllis Vance to run real MX record lookups, SPF/DKIM/DMARC
 * validation, blacklist checks, and SMTP diagnostics.
 */
export class MxToolboxClient {
  private static readonly BASE_URL = "https://mxtoolbox.com/api/v1";
  private readonly apiKey: string;

  constructor(config: MxToolboxConfig) {
    this.apiKey = config.api_key;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${MxToolboxClient.BASE_URL}${path}`;

    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MxToolbox API ${path} failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as T;
  }

  // ── MX Lookup ─────────────────────────────────────────────────────

  async mxLookup(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/mx/${domain}`);
  }

  // ── SPF Lookup ────────────────────────────────────────────────────

  async spfLookup(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/spf/${domain}`);
  }

  // ── DKIM Lookup ───────────────────────────────────────────────────

  async dkimLookup(
    domain: string,
    selector = "default",
  ): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(
      `/lookup/dkim/${selector}._domainkey.${domain}`,
    );
  }

  // ── DMARC Lookup ──────────────────────────────────────────────────

  async dmarcLookup(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/dmarc/${domain}`);
  }

  // ── Blacklist Check ───────────────────────────────────────────────

  async blacklistCheck(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/blacklist/${domain}`);
  }

  // ── SMTP Test ─────────────────────────────────────────────────────

  async smtpTest(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/smtp/${domain}`);
  }

  // ── DNS Lookup ────────────────────────────────────────────────────

  async dnsLookup(domain: string): Promise<MxToolboxResult> {
    return this.request<MxToolboxResult>(`/lookup/dns/${domain}`);
  }

  // ── Full Domain Health Check ──────────────────────────────────────

  async fullDomainCheck(domain: string): Promise<MxToolboxDomainHealth> {
    const [mx, spf, dmarc, blacklist] = await Promise.allSettled([
      this.mxLookup(domain),
      this.spfLookup(domain),
      this.dmarcLookup(domain),
      this.blacklistCheck(domain),
    ]);

    return {
      domain,
      mx: mx.status === "fulfilled" ? mx.value : null,
      spf: spf.status === "fulfilled" ? spf.value : null,
      dmarc: dmarc.status === "fulfilled" ? dmarc.value : null,
      blacklist: blacklist.status === "fulfilled" ? blacklist.value : null,
    };
  }
}

// ── MxToolbox Types ───────────────────────────────────────────────────

export interface MxToolboxResult {
  readonly Command?: string;
  readonly CommandArgument?: string;
  readonly IsTransitioned?: boolean;
  readonly MxRep?: number;
  readonly EmailServiceProvider?: string;
  readonly Failed?: ReadonlyArray<MxToolboxEntry>;
  readonly Warnings?: ReadonlyArray<MxToolboxEntry>;
  readonly Passed?: ReadonlyArray<MxToolboxEntry>;
  readonly Information?: ReadonlyArray<MxToolboxEntry>;
  readonly Errors?: ReadonlyArray<string>;
  readonly Timeouts?: ReadonlyArray<string>;
  readonly RelatedLookups?: ReadonlyArray<{
    readonly Name?: string;
    readonly URL?: string;
    readonly Command?: string;
    readonly CommandArgument?: string;
  }>;
  readonly [key: string]: unknown;
}

export interface MxToolboxEntry {
  readonly ID?: number;
  readonly Name?: string;
  readonly Info?: string;
  readonly Url?: string;
  readonly PublicDescription?: string;
  readonly IsExcludedByUser?: boolean;
  readonly [key: string]: unknown;
}

export interface MxToolboxDomainHealth {
  readonly domain: string;
  readonly mx: MxToolboxResult | null;
  readonly spf: MxToolboxResult | null;
  readonly dmarc: MxToolboxResult | null;
  readonly blacklist: MxToolboxResult | null;
}
