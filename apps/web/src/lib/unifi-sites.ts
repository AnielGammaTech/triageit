/**
 * UniFi Site Manager site listing shared by the customer-mapping and
 * automapper routes.
 *
 * - Queries every configured account (api_key + extra_api_keys) and merges
 * - Names by SITE (meta.desc) when meaningful — on a multi-site web-hosted
 *   controller every site would otherwise display as the console's name —
 *   falling back to the console name for single-site "Default" consoles
 * - Ids are hostId:siteId composites, matching integration_mappings and
 *   the worker's getSiteByHostId lookup
 */

export interface UnifiSiteEntry {
  readonly id: string;
  readonly name: string;
}

const BASE_URL = "https://api.ui.com";

interface RawSite {
  readonly hostId?: string;
  readonly siteId?: string;
  readonly meta?: { readonly name?: string; readonly desc?: string };
}

interface RawHost {
  readonly id?: string;
  readonly reportedState?: { readonly name?: string; readonly hostname?: string };
  readonly userData?: { readonly name?: string };
}

async function fetchAllPages<T>(path: string, apiKey: string): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const tokenParam = nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : "";
    const res = await fetch(`${BASE_URL}${path}?pageSize=200${tokenParam}`, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`UniFi API ${path} failed (${res.status})`);
    }
    const data = (await res.json()) as { data?: T[]; nextToken?: string };
    items.push(...(data.data ?? []));
    nextToken = data.nextToken;
    pages++;
  } while (nextToken && pages < 50);

  return items;
}

export async function fetchUnifiSiteList(
  config: Record<string, unknown>,
): Promise<UnifiSiteEntry[]> {
  const keys = [config.api_key, ...(Array.isArray(config.extra_api_keys) ? config.extra_api_keys : [])]
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0);

  const entries: UnifiSiteEntry[] = [];

  for (const key of keys) {
    try {
      const [sites, hosts] = await Promise.all([
        fetchAllPages<RawSite>("/v1/sites", key),
        fetchAllPages<RawHost>("/v1/hosts", key),
      ]);

      const hostNames = new Map<string, string>();
      for (const host of hosts) {
        const name = host.reportedState?.name ?? host.userData?.name ?? host.reportedState?.hostname;
        if (host.id && name) hostNames.set(host.id, name);
      }

      for (const site of sites) {
        const hostId = site.hostId ?? "";
        const siteId = site.siteId ?? "";
        if (!hostId && !siteId) continue;

        const desc = site.meta?.desc ?? site.meta?.name;
        const siteName = desc && desc !== "Default" ? desc : null;
        const name = siteName ?? hostNames.get(hostId) ?? `Site ${hostId.slice(0, 8)}`;

        entries.push({
          id: siteId ? `${hostId}:${siteId}` : hostId,
          name,
        });
      }
    } catch (error) {
      console.warn("[UNIFI] Site list fetch failed for one account (continuing):", error);
    }
  }

  return entries;
}
