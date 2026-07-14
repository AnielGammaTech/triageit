import { isIP } from "node:net";
import type { NextRequest } from "next/server";

function validIp(candidate: string | null): string | null {
  const value = candidate?.trim() ?? "";
  return isIP(value) ? value : null;
}

export function getClientIp(request: NextRequest): string | null {
  const cloudflareIp = validIp(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;

  const railwayIp = validIp(request.headers.get("x-real-ip"));
  if (railwayIp) return railwayIp;

  if (process.env.NODE_ENV !== "production") {
    const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
    return validIp(forwardedIp);
  }

  return null;
}

export function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = process.env.NODE_ENV === "production" ? "https" : forwardedProto || request.nextUrl.protocol.slice(0, -1);

  if (host && (protocol === "https" || protocol === "http")) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      // Fall back to Next's parsed origin below.
    }
  }

  return request.nextUrl.origin;
}
