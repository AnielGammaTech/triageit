export const SOP_STATUSES = ["Draft", "In Review", "Approved", "Retired"] as const;

export type SopStatus = (typeof SOP_STATUSES)[number];

export interface SopScreenshot {
  readonly filename: string;
  readonly url: string;
  readonly alt?: string;
  readonly uploaded_at: string;
}

export interface SopRecord {
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  readonly approver: string;
  readonly status: SopStatus;
  readonly version: string;
  readonly effective_date: string;
  readonly last_reviewed: string;
  readonly next_review: string;
  readonly classification: string;
  readonly content_html: string;
  readonly tags: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string;
  readonly updated_by: string;
  readonly screenshots: readonly SopScreenshot[];
}

export interface SopRedirect {
  readonly from_slug: string;
  readonly to_slug: string;
  readonly created_at: string;
}

export interface SopStore {
  readonly sops: readonly SopRecord[];
}

export interface RedirectStore {
  readonly redirects: readonly SopRedirect[];
}
