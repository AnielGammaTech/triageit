import { SOP_CATEGORIES } from "./categories";
import { ensureSlug } from "./slug";
import { SOP_STATUSES, type SopRecord, type SopStatus } from "./types";

const DEFAULT_DATE = "2026-05-05";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asTags(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => asString(tag)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function asStatus(value: unknown): SopStatus {
  const status = asString(value);
  return SOP_STATUSES.includes(status as SopStatus) ? (status as SopStatus) : "Draft";
}

function asCategory(value: unknown): string {
  const category = asString(value);
  return category || SOP_CATEGORIES[0];
}

function asDate(value: unknown, fallback = DEFAULT_DATE): string {
  const date = asString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

export function normalizeSopInput(input: Record<string, unknown>, existing?: SopRecord): SopRecord {
  const title = asString(input.title, existing?.title ?? "Untitled SOP");
  const now = new Date().toISOString();
  const slug = ensureSlug(asString(input.slug, existing?.slug ?? title), "untitled-sop");

  return {
    slug,
    title,
    category: asCategory(input.category ?? existing?.category),
    owner: asString(input.owner, existing?.owner ?? "Service Desk"),
    approver: asString(input.approver, existing?.approver ?? "Operations"),
    status: asStatus(input.status ?? existing?.status),
    version: asString(input.version, existing?.version ?? "1.0"),
    effective_date: asDate(input.effective_date, existing?.effective_date ?? DEFAULT_DATE),
    last_reviewed: asDate(input.last_reviewed, existing?.last_reviewed ?? DEFAULT_DATE),
    next_review: asDate(input.next_review, existing?.next_review ?? DEFAULT_DATE),
    classification: asString(input.classification, existing?.classification ?? "Internal"),
    content_html: asString(input.content_html, existing?.content_html ?? "<section><h2>1. Purpose</h2><p></p></section>"),
    tags: asTags(input.tags ?? existing?.tags),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    created_by: asString(input.created_by, existing?.created_by ?? "followit-admin"),
    updated_by: asString(input.updated_by, "followit-admin"),
    screenshots: existing?.screenshots ?? [],
  };
}
