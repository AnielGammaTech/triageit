export function formatDisplayDate(value: string): string {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function isDueForReview(nextReview: string, today = new Date()): boolean {
  if (!nextReview) return false;
  const reviewDate = new Date(`${nextReview}T00:00:00`);
  if (Number.isNaN(reviewDate.getTime())) return false;
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + 30);
  return reviewDate <= windowEnd;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function purposeDescription(contentHtml: string): string {
  const purposeMatch = contentHtml.match(
    /<h[2-3][^>]*>\s*(?:\d+\.\s*)?Purpose\s*<\/h[2-3]>([\s\S]*?)(?:<h[2-3][^>]*>|$)/i,
  );
  if (!purposeMatch) return stripHtml(contentHtml).slice(0, 180);
  return stripHtml(purposeMatch[1] ?? "").slice(0, 180);
}
