const NON_CUSTOMER_CLIENTS = new Set([
  "alerts",
  "unknown",
  "gamma tech services llc",
]);

function normalizedClientName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** First-response accountability applies to real customer tickets, not system intake. */
export function isCustomerResponseClient(value: string | null | undefined): boolean {
  const client = normalizedClientName(value);
  return client.length > 0 && !NON_CUSTOMER_CLIENTS.has(client);
}
