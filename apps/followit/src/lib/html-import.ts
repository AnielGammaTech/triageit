import { normalizeSopInput } from "./sop-input";
import { stripHtml } from "./format";
import { ensureSlug } from "./slug";
import type { SopRecord } from "./types";

function firstMatch(html: string, patterns: readonly RegExp[]): string {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]).trim();
  }
  return "";
}

function metadataValue(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(html, [
    new RegExp(`<[^>]*>\\s*${escaped}\\s*<\\/[^>]+>\\s*<[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
    new RegExp(`${escaped}\\s*:?\\s*<\\/[^>]+>\\s*<[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
    new RegExp(`${escaped}\\s*:?\\s*([^<\\n]+)`, "i"),
  ]);
}

function bodyContent(html: string): string {
  const explicit = html.match(/<!--\s*SOP_CONTENT_START\s*-->([\s\S]*?)<!--\s*SOP_CONTENT_END\s*-->/i);
  if (explicit?.[1]) return sanitizeContent(explicit[1]);

  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1]) return sanitizeContent(main[1]);

  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const raw = body?.[1] ?? html;
  return sanitizeContent(
    raw
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, ""),
  );
}

function sanitizeContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .trim();
}

export function parseSopHtml(html: string, filename: string): SopRecord {
  const title = firstMatch(html, [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]) || filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

  const today = new Date().toISOString().slice(0, 10);
  const imported = normalizeSopInput({
    slug: ensureSlug(metadataValue(html, "Slug") || title, "imported-sop"),
    title,
    category: metadataValue(html, "Category"),
    owner: metadataValue(html, "Owner"),
    approver: metadataValue(html, "Approver"),
    status: metadataValue(html, "Status") || "Draft",
    version: metadataValue(html, "Version") || "1.0",
    effective_date: metadataValue(html, "Effective Date") || today,
    last_reviewed: metadataValue(html, "Last Reviewed") || today,
    next_review: metadataValue(html, "Next Review") || today,
    classification: metadataValue(html, "Classification") || "Internal",
    tags: metadataValue(html, "Tags"),
    content_html: bodyContent(html),
    created_by: "followit-import",
    updated_by: "followit-import",
  });

  return imported;
}
