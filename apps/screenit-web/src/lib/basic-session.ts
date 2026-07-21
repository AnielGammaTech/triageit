export const SCREENIT_SESSION_COOKIE = "screenit_session";
export const SCREENIT_SESSION_SECONDS = 8 * 60 * 60;

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createScreenItSession(email: string, secret: string): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + SCREENIT_SESSION_SECONDS }));
  const encodedPayload = base64UrlEncode(payload);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(encodedPayload)));
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function verifyScreenItSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), base64UrlDecode(signature), new TextEncoder().encode(payload));
    if (!valid) return false;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as { exp?: number };
    return typeof parsed.exp === "number" && parsed.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
