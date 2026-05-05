import { slugify } from "./slug";

export const SOP_CATEGORIES = [
  "PSA & Ticketing",
  "M365 / CIPP",
  "Identity & MDM",
  "Networking",
  "Security & Compliance",
  "Client Onboarding & Offboarding",
  "Backup & DR",
  "Internal Operations",
  "Index & Standards",
] as const;

export type SopCategory = (typeof SOP_CATEGORIES)[number];

export function categorySlug(category: string): string {
  return slugify(category.replace("&", "and"));
}

export function categoryFromSlug(slug: string): string | undefined {
  return SOP_CATEGORIES.find((category) => categorySlug(category) === slug);
}
