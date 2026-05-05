import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { seedSops } from "@/data/seed-sops";
import type { RedirectStore, SopRecord, SopRedirect, SopStore } from "./types";

const STORE_FILE = "sops.json";
const REDIRECT_FILE = "redirects.json";

function dataDir(): string {
  return process.env.FOLLOWIT_DATA_DIR ?? path.join(process.cwd(), ".followit-data");
}

export function uploadDir(): string {
  return process.env.FOLLOWIT_UPLOAD_DIR ?? path.join(dataDir(), "uploads");
}

function storePath(): string {
  return path.join(dataDir(), STORE_FILE);
}

function redirectPath(): string {
  return path.join(dataDir(), REDIRECT_FILE);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function ensureStore(): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.mkdir(uploadDir(), { recursive: true });

  if (!(await pathExists(storePath()))) {
    await writeJsonAtomic(storePath(), { sops: seedSops satisfies readonly SopRecord[] });
  }

  if (!(await pathExists(redirectPath()))) {
    await writeJsonAtomic(redirectPath(), { redirects: [] satisfies readonly SopRedirect[] });
  }
}

async function readStore(): Promise<SopStore> {
  await ensureStore();
  const raw = await fs.readFile(storePath(), "utf8");
  const parsed = JSON.parse(raw) as SopStore;
  return { sops: parsed.sops ?? [] };
}

async function writeStore(sops: readonly SopRecord[]): Promise<void> {
  await ensureStore();
  await writeJsonAtomic(storePath(), { sops });
}

async function readRedirects(): Promise<RedirectStore> {
  await ensureStore();
  const raw = await fs.readFile(redirectPath(), "utf8");
  const parsed = JSON.parse(raw) as RedirectStore;
  return { redirects: parsed.redirects ?? [] };
}

async function writeRedirects(redirects: readonly SopRedirect[]): Promise<void> {
  await ensureStore();
  await writeJsonAtomic(redirectPath(), { redirects });
}

export async function listSops(): Promise<readonly SopRecord[]> {
  const store = await readStore();
  return [...store.sops].sort((a, b) => a.title.localeCompare(b.title));
}

export async function listPublishedSops(): Promise<readonly SopRecord[]> {
  const sops = await listSops();
  return sops.filter((sop) => sop.status === "Approved");
}

export async function getSop(slug: string): Promise<SopRecord | undefined> {
  const sops = await listSops();
  return sops.find((sop) => sop.slug === slug);
}

export async function resolveSopSlug(slug: string): Promise<string | undefined> {
  if (await getSop(slug)) return slug;
  const redirectStore = await readRedirects();
  const redirect = redirectStore.redirects.find((item) => item.from_slug === slug);
  return redirect?.to_slug;
}

export async function upsertSop(sop: SopRecord, previousSlug?: string): Promise<SopRecord> {
  const sops = await listSops();
  const now = new Date().toISOString();
  const existing = sops.find((item) => item.slug === (previousSlug ?? sop.slug));
  const record: SopRecord = {
    ...sop,
    created_at: existing?.created_at ?? sop.created_at ?? now,
    updated_at: now,
  };

  const nextSops = sops
    .filter((item) => item.slug !== record.slug && item.slug !== previousSlug)
    .concat(record)
    .sort((a, b) => a.title.localeCompare(b.title));

  await writeStore(nextSops);

  if (previousSlug && previousSlug !== record.slug) {
    const redirectStore = await readRedirects();
    const redirect: SopRedirect = {
      from_slug: previousSlug,
      to_slug: record.slug,
      created_at: now,
    };
    const nextRedirects = redirectStore.redirects
      .filter((item) => item.from_slug !== previousSlug)
      .concat(redirect);
    await writeRedirects(nextRedirects);
  }

  return record;
}

export async function deleteSop(slug: string): Promise<boolean> {
  const sops = await listSops();
  const nextSops = sops.filter((sop) => sop.slug !== slug);
  if (nextSops.length === sops.length) return false;
  await writeStore(nextSops);
  return true;
}

export async function safeUploadPath(filename: string): Promise<string> {
  await ensureStore();
  const clean = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stamped = `${Date.now()}-${clean || "upload"}`;
  return path.join(uploadDir(), stamped);
}
