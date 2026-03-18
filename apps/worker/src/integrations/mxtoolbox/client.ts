import type { MxToolboxConfig } from "@triageit/shared";
import type { MxLookupResponse, EmailDiagnostics } from "./types.js";

const BASE_URL = "https://mxtoolbox.com/api/v1";

export class MxToolboxClient {
  constructor(private readonly config: MxToolboxConfig) {}

  private async lookup(
    type: string,
    argument: string,
  ): Promise<MxLookupResponse> {
    const url = `${BASE_URL}/Lookup/${type}/${argument}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.config.api_key,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `MX Toolbox ${type} lookup failed (${response.status}): ${text}`,
      );
    }

    return (await response.json()) as MxLookupResponse;
  }

  async mxLookup(domain: string): Promise<MxLookupResponse> {
    return this.lookup("mx", domain);
  }

  async spfLookup(domain: string): Promise<MxLookupResponse> {
    return this.lookup("spf", domain);
  }

  async dmarcLookup(domain: string): Promise<MxLookupResponse> {
    return this.lookup("dmarc", domain);
  }

  async blacklistCheck(domainOrIp: string): Promise<MxLookupResponse> {
    return this.lookup("blacklist", domainOrIp);
  }

  async smtpDiagnostics(mailServer: string): Promise<MxLookupResponse> {
    return this.lookup("smtp", mailServer);
  }

  async runFullDiagnostics(domain: string): Promise<EmailDiagnostics> {
    const errors: string[] = [];

    const safeCall = async (
      fn: () => Promise<MxLookupResponse>,
      label: string,
    ): Promise<MxLookupResponse | null> => {
      try {
        return await fn();
      } catch (err) {
        errors.push(
          `${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    };

    const [mx, spf, dmarc, blacklist] = await Promise.all([
      safeCall(() => this.mxLookup(domain), "MX lookup"),
      safeCall(() => this.spfLookup(domain), "SPF lookup"),
      safeCall(() => this.dmarcLookup(domain), "DMARC lookup"),
      safeCall(() => this.blacklistCheck(domain), "Blacklist check"),
    ]);

    // Run SMTP against the first MX record if available
    let smtp: MxLookupResponse | null = null;
    const firstMxHost = mx?.Information?.[0]?.Hostname;
    if (firstMxHost) {
      smtp = await safeCall(
        () => this.smtpDiagnostics(firstMxHost),
        "SMTP diagnostics",
      );
    }

    return { domain, mx, spf, dmarc, blacklist, smtp, errors };
  }
}
