import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "followit_admin";

function configuredUser(): string {
  return process.env.FOLLOWIT_ADMIN_USER ?? "admin";
}

function configuredPassword(): string {
  return process.env.FOLLOWIT_ADMIN_PASSWORD ?? (process.env.NODE_ENV === "production" ? "" : "followit");
}

function sessionToken(): string {
  const password = configuredPassword();
  if (!password) return "";
  return createHash("sha256")
    .update(`${configuredUser()}:${password}:followit`)
    .digest("hex");
}

function safeCompare(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateAdminCredentials(user: string, password: string): boolean {
  return user === configuredUser() && safeCompare(password, configuredPassword());
}

export async function isAdminSession(): Promise<boolean> {
  const token = sessionToken();
  if (!token) return false;
  const cookieStore = await cookies();
  return safeCompare(cookieStore.get(COOKIE_NAME)?.value ?? "", token);
}

export async function setAdminSession(): Promise<void> {
  const token = sessionToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function requestHasAdminSession(request: Request): boolean {
  const token = sessionToken();
  if (!token) return false;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookiesByName = new Map(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        return separator >= 0 ? [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))] : [cookie, ""];
      }),
  );
  return safeCompare(cookiesByName.get(COOKIE_NAME) ?? "", token);
}
