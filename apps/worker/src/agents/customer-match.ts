import type { TriageContext } from "./types.js";

/**
 * Shared customer-matching helpers. Integrations match Halo clients to
 * their own customer records by name, but names drift ("ALLEN CONCRETE &
 * MASONRY, INC" vs "Allen Concrete") and some tenants own several email
 * domains (evllc.com under Quality Enterprise). The email domain from the
 * ticket is a second, often stronger signal.
 */

const INTERNAL_DOMAINS = new Set(["gamma.tech", "gtmail.us"]);

/**
 * Pull the most likely customer email domain out of the ticket context.
 * Prefers the reporting user's email; falls back to any email found in
 * the summary/details. Gamma's own domains are excluded.
 */
export function extractEmailDomain(context: TriageContext): string | null {
  const candidates: string[] = [];

  if (context.userEmail) candidates.push(context.userEmail);
  const text = `${context.summary} ${context.details ?? ""}`;
  const found = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) ?? [];
  candidates.push(...found);

  for (const email of candidates) {
    const domain = email.split("@")[1]?.toLowerCase().trim();
    if (domain && !INTERNAL_DOMAINS.has(domain)) return domain;
  }
  return null;
}

/**
 * The registrable base of a domain without TLD — "evllc.com" → "evllc".
 * Useful as a name-search candidate when the client name doesn't match.
 */
export function domainBaseName(domain: string): string {
  return domain.split(".")[0]?.toLowerCase() ?? domain;
}

/** Normalize a company name for fuzzy comparison across systems. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.\-_'"()]/g, " ")
    .replace(/\b(llc|inc|incorporated|corp|corporation|ltd|limited|co|company|the|group|services|solutions|enterprises|lp|pllc|pc|pa)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the bare hostname from a URL-ish string ("https://www.evllc.com/x" → "evllc.com"). */
export function hostnameOf(urlish: string): string | null {
  const cleaned = urlish.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const host = cleaned.split(/[/?#]/)[0];
  return host && host.includes(".") ? host : null;
}
