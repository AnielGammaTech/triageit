import { GRAPH_BASE_URL } from "./constants.js";
import {
  decodeJwtNumericClaim,
  requestClientCredentialsToken,
  type FetchLike,
  type MsGraphCredentials,
} from "./auth.js";

/**
 * Microsoft Graph calendar client (client-credentials, Calendars.ReadWrite).
 * Follows the error≠empty convention: every lookup returns null when it
 * FAILED — callers must never treat null as "no events".
 */

/** Normalized calendarView event. Times are UTC ISO strings. */
export interface MsGraphCalendarEvent {
  readonly subject: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly showAs: string; // free | tentative | busy | oof | workingElsewhere | unknown
  readonly isAllDay: boolean;
}

interface GraphDateTime {
  readonly dateTime?: string;
  readonly timeZone?: string;
}

interface RawGraphEvent {
  readonly subject?: string;
  readonly start?: GraphDateTime;
  readonly end?: GraphDateTime;
  readonly showAs?: string;
  readonly isAllDay?: boolean;
}

// ── Module-level token cache ──────────────────────────────────────────
// One app credential serves every mailbox read, so the token is cached
// module-wide until ~2 minutes before expiry. An in-flight promise is
// shared so parallel per-tech reads don't each hit the token endpoint.

const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;
const TOKEN_FALLBACK_TTL_MS = 30 * 60_000; // when exp can't be decoded

let tokenCache: { readonly key: string; readonly token: string; readonly expiresAtMs: number } | null = null;
let tokenInflight: { readonly key: string; readonly promise: Promise<string> } | null = null;

async function getCachedToken(credentials: MsGraphCredentials, fetchFn: FetchLike): Promise<string> {
  const key = `${credentials.tenant_id}:${credentials.client_id}`;
  if (tokenCache?.key === key && Date.now() < tokenCache.expiresAtMs - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.token;
  }
  if (tokenInflight?.key === key) return tokenInflight.promise;

  const promise = requestClientCredentialsToken(credentials, fetchFn)
    .then((token) => {
      const exp = decodeJwtNumericClaim(token, "exp");
      tokenCache = {
        key,
        token,
        expiresAtMs: exp !== null ? exp * 1000 : Date.now() + TOKEN_FALLBACK_TTL_MS,
      };
      return token;
    })
    .finally(() => {
      tokenInflight = null;
    });
  tokenInflight = { key, promise };
  return promise;
}

// ── ET wall-clock → UTC ───────────────────────────────────────────────
// calendarView is requested with Prefer: outlook.timezone="Eastern Standard
// Time", so Graph returns wall-clock times in ET with no offset. Convert by
// parsing as server-local, then shifting by the server-local↔ET difference
// at that instant (same trick as board-sources' etTodayBounds).

function etWallToUtcMs(wall: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const localMs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  const etWall = new Date(
    new Date(localMs).toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return localMs + (localMs - etWall.getTime());
}

function graphDateTimeToIso(g: GraphDateTime | undefined): string | null {
  const wall = typeof g?.dateTime === "string" ? g.dateTime : null;
  if (!wall) return null;
  const tz = g?.timeZone ?? "UTC";
  const ms = tz === "UTC" ? Date.parse(wall.endsWith("Z") ? wall : `${wall}Z`) : etWallToUtcMs(wall);
  return ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeEvent(raw: RawGraphEvent): MsGraphCalendarEvent | null {
  const startsAt = graphDateTimeToIso(raw.start);
  const endsAt = graphDateTimeToIso(raw.end);
  if (!startsAt || !endsAt) return null;
  return {
    subject: typeof raw.subject === "string" && raw.subject.trim() ? raw.subject : null,
    startsAt,
    endsAt,
    showAs: typeof raw.showAs === "string" ? raw.showAs : "unknown",
    isAllDay: raw.isAllDay === true,
  };
}

// ── Client ────────────────────────────────────────────────────────────

export class MsGraphClient {
  constructor(
    private readonly credentials: MsGraphCredentials,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  /**
   * Events on one mailbox in [startIso, endIso). Returns null when the
   * LOOKUP FAILED (lookupFailed pattern) — never an empty calendar.
   */
  async getCalendarView(
    email: string,
    startIso: string,
    endIso: string,
  ): Promise<ReadonlyArray<MsGraphCalendarEvent> | null> {
    try {
      const token = await getCachedToken(this.credentials, this.fetchFn);
      const params = new URLSearchParams({
        startDateTime: startIso,
        endDateTime: endIso,
        $select: "subject,start,end,showAs,isAllDay",
        $top: "50",
      });
      const response = await this.fetchFn(
        `${GRAPH_BASE_URL}/users/${encodeURIComponent(email)}/calendarView?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Prefer: 'outlook.timezone="Eastern Standard Time"',
          },
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn(
          `[MSGRAPH] calendarView for ${email} failed (${response.status}): ${body.slice(0, 200)}`,
        );
        return null;
      }
      const payload = (await response.json().catch(() => null)) as { value?: RawGraphEvent[] } | null;
      if (!payload || !Array.isArray(payload.value)) {
        console.warn(`[MSGRAPH] calendarView for ${email} returned an unreadable payload`);
        return null;
      }
      return payload.value
        .map(normalizeEvent)
        .filter((e): e is MsGraphCalendarEvent => e !== null);
    } catch (err) {
      console.warn(
        `[MSGRAPH] calendarView for ${email} failed:`,
        err instanceof Error ? err.message : err,
      );
      return null; // lookupFailed — caller must not treat as "no events"
    }
  }
}
