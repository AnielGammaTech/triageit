export type MockupKey =
  | "triageit"
  | "secureit"
  | "projectit"
  | "portalit"
  | "quoteit"
  | "connectit"
  | "runit"
  | "phoneit";

export interface Feature {
  readonly title: string;
  readonly blurb: string;
}

export interface Tool {
  readonly slug: MockupKey;
  readonly name: string;
  readonly oneLiner: string; // suite-grid card
  readonly tagline: string; // section headline
  readonly description: string; // 1-2 sentences under the tagline
  readonly features: readonly Feature[]; // 3-4 items
  readonly integrations: readonly string[]; // shown as small pills
  readonly accent: string; // tailwind color token name, e.g. "triageit"
  readonly mockup: MockupKey;
  readonly screenshotSrc?: string; // when set, replaces the CSS mockup
}
