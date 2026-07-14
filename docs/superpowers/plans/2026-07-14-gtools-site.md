# gtools.io Promotional Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/gtools`, a statically-generated single-page dark-premium showcase of Gamma Tech's 8-tool suite, ready to deploy as a "gtools" service in the TriageIT Railway project at apex domain `gtools.io`.

**Architecture:** New Next.js workspace app in the TriageIt monorepo. All copy lives in one typed content module (`src/content/tools.ts`); layout components render from that data. Tool "screenshots" are CSS-built mockups inside a shared `BrowserFrame`, composed from small mock primitives, each replaceable later via a `screenshotSrc` field. No database, no auth, no API routes, no env vars.

**Tech Stack:** Next.js `^16.3.0-canary.75` (match `apps/web` exactly), React 19, Tailwind CSS 4 (CSS-first `@theme` config), TypeScript 5.7, Vitest 3 for content tests.

**Spec:** `docs/superpowers/specs/2026-07-14-gtools-site-design.md` — read it before starting.

## Global Constraints

- Dependency versions must match `apps/web` where shared: `next ^16.3.0-canary.75`, `react ^19.0.0`, `tailwindcss ^4.0.0`, `typescript ^5.7.0`, `eslint ^9.39.4`.
- Build command is `next build --webpack` (matches `apps/web`; the canary's default bundler is not what production uses).
- Dev port **3002** (web uses 3000).
- Domain: apex `gtools.io` ONLY — never reference `www.gtools.io` anywhere.
- Contact CTA is always `mailto:help@gamma.tech`. No forms, no analytics.
- Honest copy: ConnectIT has exactly 2 live connectors (HaloPSA, Twilio Lookup) — other connectors are "expanding catalog", never "shipped". No claims about QuoteIT online payments or PortalIT Stripe billing.
- Footer identity: "Gamma Tech Services LLC · Naples, FL" with a link to `https://gamma.tech`.
- Immutability: never mutate objects/arrays; content module exports are `as const` / readonly.
- Files under 300 lines each; one responsibility per file.
- Visual work (Tasks 3–7): the implementer MUST load the `frontend-design` skill first and follow the design tokens in `globals.css`. Dark premium register (Linear/Vercel): near-black ground, high-contrast type, generous spacing, per-tool accent used only for glows/chrome/highlights.

## File Structure

```
apps/gtools/
  package.json            # workspace app "gtools"
  tsconfig.json
  next.config.ts
  postcss.config.mjs
  eslint.config.mjs
  vitest.config.ts
  railway.json            # Railway service config-as-code
  src/
    app/
      layout.tsx          # fonts, metadata, OG tags
      globals.css         # Tailwind 4 @theme tokens (colors, fonts)
      page.tsx            # assembles: Nav→Hero→SuiteGrid→BetterTogether→8×ToolSection→Footer
    content/
      types.ts            # Tool, Feature, MockupKey types
      tools.ts            # ALL copy for the 8 tools (single source of truth)
    components/
      nav.tsx
      hero.tsx
      suite-grid.tsx
      better-together.tsx
      tool-section.tsx    # alternating layout, renders a Tool + its mockup
      footer.tsx
      browser-frame.tsx   # shared mockup chrome + accent glow + screenshotSrc escape hatch
      mock-ui.tsx         # tiny presentational primitives shared by all mockups
      mockups/
        index.ts          # MOCKUPS registry: MockupKey → component
        triageit.tsx  secureit.tsx  projectit.tsx  portalit.tsx
        quoteit.tsx   connectit.tsx runit.tsx      phoneit.tsx
    __tests__/
      content.test.ts     # content integrity (8 tools, unique slugs, fields non-empty)
      registry.test.ts    # every tool.mockup key exists in MOCKUPS
```

---

### Task 1: Scaffold `apps/gtools` workspace app

**Files:**
- Create: `apps/gtools/package.json`
- Create: `apps/gtools/tsconfig.json`
- Create: `apps/gtools/next.config.ts`
- Create: `apps/gtools/postcss.config.mjs`
- Create: `apps/gtools/eslint.config.mjs`
- Create: `apps/gtools/src/app/layout.tsx`
- Create: `apps/gtools/src/app/globals.css`
- Create: `apps/gtools/src/app/page.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a building Next.js app; `globals.css` design tokens (`--color-ink`, `--color-panel`, `--color-line`, `--color-brand`, `--font-display`, `--font-body`) that ALL later tasks use via Tailwind utilities (`bg-ink`, `bg-panel`, `border-line`, `text-brand`, `font-display`).

- [ ] **Step 1: Create package.json**

```json
{
  "name": "gtools",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^16.3.0-canary.75",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^9.39.4",
    "eslint-config-next": "^16.3.0-canary.75",
    "postcss": "^8.5.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (copy `apps/web/tsconfig.json` verbatim — read it first; it defines `@/*` path alias and Next plugin. If web has no `@/*` alias, add `"paths": {"@/*": ["./src/*"]}` under compilerOptions.)

- [ ] **Step 3: Create next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Create postcss.config.mjs**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 5: Create eslint.config.mjs** (copy `apps/web`'s eslint config file verbatim, adjusting only paths if any are web-specific).

- [ ] **Step 6: Create globals.css with the design system tokens**

```css
@import "tailwindcss";

@theme {
  --color-ink: #08080d;        /* page ground */
  --color-panel: #101018;      /* raised surfaces, mockup chrome */
  --color-panel-2: #16161f;    /* nested surfaces inside mockups */
  --color-line: #23232e;       /* hairline borders */
  --color-fog: #9b9ba8;        /* secondary text */
  --color-snow: #f2f2f5;       /* primary text */
  --color-brand: #6e7bff;      /* GTools brand accent */

  /* per-tool accents (used for section glows, mockup chrome, feature ticks) */
  --color-triageit: #f59e0b;
  --color-secureit: #f43f5e;
  --color-projectit: #8b5cf6;
  --color-portalit: #10b981;
  --color-quoteit: #0ea5e9;
  --color-connectit: #22d3ee;
  --color-runit: #ef4444;
  --color-phoneit: #a3e635;

  --font-display: var(--font-space-grotesk), sans-serif;
  --font-body: var(--font-inter), sans-serif;
}

html {
  scroll-behavior: smooth;
}

body {
  background: var(--color-ink);
  color: var(--color-snow);
  font-family: var(--font-body);
}
```

- [ ] **Step 7: Create layout.tsx**

```tsx
import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "GTools — The software we built to run our MSP",
  description:
    "Eight products engineered by Gamma Tech Services to triage tickets, stop attacks, reconcile billing, and keep clients informed.",
  metadataBase: new URL("https://gtools.io"),
  openGraph: {
    title: "GTools — The software we built to run our MSP",
    description:
      "Eight products engineered by Gamma Tech Services to triage tickets, stop attacks, reconcile billing, and keep clients informed.",
    url: "https://gtools.io",
    siteName: "GTools",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create placeholder page.tsx**

```tsx
export default function Home() {
  return <main className="min-h-screen font-display text-4xl p-16">GTools</main>;
}
```

- [ ] **Step 9: Install and verify build**

Run (from repo root): `npm install`
Expected: lockfile updates, no errors.
Run: `npx turbo build --filter=gtools`
Expected: `Tasks: 1 successful` — Next build completes.

- [ ] **Step 10: Commit**

```bash
git add apps/gtools package-lock.json
git commit -m "feat: scaffold gtools promotional site app"
```

---

### Task 2: Content module with integrity tests (TDD)

**Files:**
- Create: `apps/gtools/src/content/types.ts`
- Create: `apps/gtools/src/content/tools.ts`
- Create: `apps/gtools/src/__tests__/content.test.ts`
- Create: `apps/gtools/vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TOOLS: readonly Tool[]` and types consumed by every layout component. Exact shape below — later tasks import `{ TOOLS }` from `@/content/tools` and `{ Tool, MockupKey }` from `@/content/types`.

- [ ] **Step 1: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: { environment: "node" },
});
```

- [ ] **Step 2: Create types.ts**

```ts
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
```

- [ ] **Step 3: Write the failing test**

```ts
// apps/gtools/src/__tests__/content.test.ts
import { describe, expect, it } from "vitest";
import { TOOLS } from "@/content/tools";

describe("tools content integrity", () => {
  it("has exactly 8 tools", () => {
    expect(TOOLS).toHaveLength(8);
  });

  it("has unique slugs matching their mockup keys", () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(8);
    for (const t of TOOLS) expect(t.mockup).toBe(t.slug);
  });

  it("has non-empty copy everywhere", () => {
    for (const t of TOOLS) {
      expect(t.name.trim()).not.toBe("");
      expect(t.oneLiner.trim()).not.toBe("");
      expect(t.tagline.trim()).not.toBe("");
      expect(t.description.trim()).not.toBe("");
      expect(t.features.length).toBeGreaterThanOrEqual(3);
      expect(t.features.length).toBeLessThanOrEqual(4);
      for (const f of t.features) {
        expect(f.title.trim()).not.toBe("");
        expect(f.blurb.trim()).not.toBe("");
      }
      expect(t.integrations.length).toBeGreaterThan(0);
      expect(t.accent).toBe(t.slug);
    }
  });

  it("never overclaims ConnectIT connectors", () => {
    const connectit = TOOLS.find((t) => t.slug === "connectit");
    const text = JSON.stringify(connectit).toLowerCase();
    expect(text).not.toContain("14 integrations live");
    expect(text).not.toContain("all connectors live");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test --workspace=gtools`
Expected: FAIL — cannot resolve `@/content/tools`.

- [ ] **Step 5: Create tools.ts with the full copy** (this copy is derived from code research of each repo — keep it verbatim unless the user edits it)

```ts
import type { Tool } from "./types";

export const TOOLS: readonly Tool[] = [
  {
    slug: "triageit",
    name: "TriageIt",
    oneLiner: "AI ticket triage for Halo PSA",
    tagline: "Every ticket triaged before a tech touches it.",
    description:
      "A multi-agent AI pipeline reads every Halo PSA ticket the moment it arrives — classifies it, rates urgency, researches your documentation and device history, and posts a structured triage note back to the ticket.",
    features: [
      {
        title: "Instant AI triage",
        blurb:
          "Classification, urgency scoring, root-cause analysis, and recommended next steps — posted to the ticket in seconds.",
      },
      {
        title: "Specialist agents in parallel",
        blurb:
          "Documentation, identity, endpoint, and backup specialists research each ticket simultaneously and pool their findings.",
      },
      {
        title: "Customer-waiting radar",
        blurb:
          "Update requests and stale replies trigger immediate Teams alerts, so no client sits unanswered.",
      },
      {
        title: "Tech coaching built in",
        blurb:
          "Automated response-time and communication reviews on every ticket keep service quality visible.",
      },
    ],
    integrations: ["Halo PSA", "Microsoft Teams", "Hudu", "Datto RMM", "JumpCloud"],
    accent: "triageit",
    mockup: "triageit",
  },
  {
    slug: "secureit",
    name: "SecureIT",
    oneLiner: "AI security analyst for Microsoft 365",
    tagline: "Your M365 tenants, watched by an analyst that never sleeps.",
    description:
      "A multi-tenant Microsoft 365 security console that ingests sign-in and audit logs across every client tenant, detects identity and email attacks, writes analyst-grade incident reports, and remediates in one click.",
    features: [
      {
        title: "20+ built-in detectors",
        blurb:
          "Token theft, password spray, impossible travel, malicious inbox rules, risky OAuth consents, MFA tampering, and more.",
      },
      {
        title: "AI incident reports",
        blurb:
          "Plain-English attack narratives with attack chain, impact assessment, confidence rating, and recommended remediation.",
      },
      {
        title: "One-click remediation",
        blurb:
          "Disable the account, revoke sessions, kill the inbox rule, block attacker IPs — straight from the incident view.",
      },
      {
        title: "Multi-tenant by design",
        blurb:
          "Onboard clients through Entra admin consent and tune known-good networks per tenant to keep alerts quiet and true.",
      },
    ],
    integrations: ["Microsoft Graph", "Entra ID", "Exchange Online", "Defender"],
    accent: "secureit",
    mockup: "secureit",
  },
  {
    slug: "projectit",
    name: "ProjectIT",
    oneLiner: "Projects, time, assets & billing in one place",
    tagline: "Run projects, time, assets, and billing on one platform.",
    description:
      "An all-in-one operations platform for service teams: task boards, time tracking wired to billing, AI-assisted proposals, IT asset management, inventory, and no-code automation — with a native iOS app.",
    features: [
      {
        title: "Boards, Gantt & milestones",
        blurb:
          "Drag-and-drop task boards with subtasks, comments, timelines, and role-based dashboards for managers and techs.",
      },
      {
        title: "Time that turns into billing",
        blurb:
          "Track time against budgets, review weekly views, and export billing-ready reports without re-keying.",
      },
      {
        title: "Asset & license management",
        blurb:
          "Full IT asset inventory with QR codes, employee assignments, license tracking, and device sync from JumpCloud.",
      },
      {
        title: "No-code automation + AI",
        blurb:
          "Trigger-action workflows with AI suggestions, AI-generated proposal content, and parts lists parsed from photos.",
      },
    ],
    integrations: ["Halo PSA", "QuickBooks", "Hudu", "JumpCloud", "iOS app"],
    accent: "projectit",
    mockup: "projectit",
  },
  {
    slug: "portalit",
    name: "PortalIT",
    oneLiner: "Vendor-stack sync & billing reconciliation",
    tagline: "Find the money your vendor stack is leaking.",
    description:
      "PortalIT syncs billing, licensing, and security data from the entire vendor stack, reconciles what you invoice against what you actually use, and gives every client a branded self-service portal.",
    features: [
      {
        title: "Billing reconciliation",
        blurb:
          "Recurring PSA invoices compared against real vendor usage — over- and under-billing surfaced automatically.",
      },
      {
        title: "40+ scheduled syncs",
        blurb:
          "PSA, distribution, RMM, backup, and security vendors pulled into one dashboard on a schedule.",
      },
      {
        title: "License hygiene",
        blurb:
          "Unused licenses detected and suspended automatically, with renewal reminders before anything lapses.",
      },
      {
        title: "Branded client portal",
        blurb:
          "Clients see their services, invoices, and quotes, and open support tickets — all in one login.",
      },
    ],
    integrations: ["Halo PSA", "Pax8", "Datto", "JumpCloud", "Microsoft 365"],
    accent: "portalit",
    mockup: "portalit",
  },
  {
    slug: "quoteit",
    name: "QuoteIT",
    oneLiner: "Quote-to-cash with e-signature",
    tagline: "From quote to signed to QuickBooks — without re-keying.",
    description:
      "Build professional hardware and service quotes, send clients a portal link to accept and e-sign online, and push the result straight into QuickBooks — with a lightweight CRM and AI-powered QBRs along for the ride.",
    features: [
      {
        title: "Sectioned quote builder",
        blurb:
          "Product catalogs, one-time and recurring pricing, auto-numbered quotes, and polished PDF output.",
      },
      {
        title: "Online accept & e-sign",
        blurb:
          "Clients review, accept, and sign from a dedicated quote portal — no printers, no attachments.",
      },
      {
        title: "QuickBooks push",
        blurb:
          "Estimates, customer mapping, and tax codes flow into QuickBooks Online the moment a deal closes.",
      },
      {
        title: "AI QBR recorder",
        blurb:
          "Record business reviews, get transcripts automatically, and let AI draft the roadmap and recap.",
      },
    ],
    integrations: ["QuickBooks", "Halo PSA", "Microsoft Teams", "ProjectIT"],
    accent: "quoteit",
    mockup: "quoteit",
  },
  {
    slug: "connectit",
    name: "ConnectIT",
    oneLiner: "The integration hub behind the suite",
    tagline: "One API for the whole stack.",
    description:
      "ConnectIT pulls data from the tools an MSP already runs, normalizes it into canonical customers, contacts, and phone numbers, and serves it to the rest of the suite through one stable API.",
    features: [
      {
        title: "One source of truth",
        blurb:
          "Customers, contacts, and phone numbers deduplicated across systems into a single normalized dataset.",
      },
      {
        title: "Audited sync runs",
        blurb:
          "Every pull tracked with status, duration, and scanned/upserted/failed counts — nothing syncs silently.",
      },
      {
        title: "Phone intelligence",
        blurb:
          "Numbers enriched with carrier, line type, and caller name via Twilio Lookup as they're ingested.",
      },
      {
        title: "Expanding connector catalog",
        blurb:
          "Halo PSA and Twilio lead an integration catalog that's growing across RMM, security, and backup vendors.",
      },
    ],
    integrations: ["Halo PSA", "Twilio", "QuoteIT", "PortalIT", "ProjectIT"],
    accent: "connectit",
    mockup: "connectit",
  },
  {
    slug: "runit",
    name: "RunIT",
    oneLiner: "The technician's power-tool drawer",
    tagline: "The tools techs reach for, in one dashboard.",
    description:
      "A web toolkit of self-contained operations tools — AI network documentation, verified file migrations, phone-prompt generation, and a shared MFA inbox — with every run logged and credentials in an encrypted vault.",
    features: [
      {
        title: "AutoDoc",
        blurb:
          "AI extracts devices, WiFi, VLANs, and VPN tunnels from pasted reports or screenshots and documents them into Hudu.",
      },
      {
        title: "Verified file migrations",
        blurb:
          "Client data moved to SharePoint Online with hash-based integrity verification and preflight review.",
      },
      {
        title: "AI voice prompts",
        blurb:
          "Text to 3CX-ready phone audio in seconds, in a range of natural AI voices — English and Spanish.",
      },
      {
        title: "TextIT shared MFA inbox",
        blurb:
          "SMS verification codes land on a team number and forward straight into Microsoft Teams.",
      },
    ],
    integrations: ["Hudu", "UniFi", "Microsoft Teams", "Twilio", "SharePoint"],
    accent: "runit",
    mockup: "runit",
  },
  {
    slug: "phoneit",
    name: "PhoneIT",
    oneLiner: "Caller ID & carrier intelligence",
    tagline: "Know who's calling — one number or five hundred.",
    description:
      "Phone-number intelligence for teams: instant caller-ID lookups, bulk CSV enrichment, and a searchable shared history — with role-based admin, invites, and audit logging.",
    features: [
      {
        title: "Instant lookups",
        blurb:
          "Caller name, carrier, and line type — mobile, landline, or VoIP — for any number in one search.",
      },
      {
        title: "Bulk CSV enrichment",
        blurb:
          "Drag in a spreadsheet of up to 500 numbers and watch results fill in with a success/fail summary.",
      },
      {
        title: "Team history",
        blurb:
          "Every lookup saved, searchable, and shared across the team — no repeat spends on the same number.",
      },
    ],
    integrations: ["Twilio Lookup", "3CX"],
    accent: "phoneit",
    mockup: "phoneit",
  },
] as const;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test --workspace=gtools`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/gtools/src/content apps/gtools/src/__tests__/content.test.ts apps/gtools/vitest.config.ts
git commit -m "feat: add gtools content model and copy for all 8 tools"
```

---

### Task 3: BrowserFrame + mock-UI primitives

**Files:**
- Create: `apps/gtools/src/components/browser-frame.tsx`
- Create: `apps/gtools/src/components/mock-ui.tsx`

**Interfaces:**
- Consumes: design tokens from Task 1.
- Produces (used by Tasks 6–7):
  - `BrowserFrame({ accent, url, screenshotSrc, children }: { accent: string; url: string; screenshotSrc?: string; children: React.ReactNode })` — browser chrome with traffic lights, URL bar, accent glow. When `screenshotSrc` is set it renders `<img>` instead of children.
  - From `mock-ui.tsx`: `MockStat({ label, value, accent? })`, `MockPill({ children, tone? })` (`tone: "ok" | "warn" | "bad" | "neutral"`), `MockRow({ cells, emphasis? }: { cells: readonly string[]; emphasis?: number })`, `MockBar({ pct, accent })`, `MockPanel({ title, children, accent? })`.

**Requirement (frontend-design skill applies):** the frame must look premium — subtle 1px `border-line` chrome on `bg-panel`, rounded-xl, an outer radial glow using the tool's accent at low opacity, and small muted traffic-light dots. Primitives are tiny (`text-[10px]`–`text-xs`) so mockups read as miniature product UI, not full-size fake apps.

- [ ] **Step 1: Implement `browser-frame.tsx`** — accent passed as a CSS color string resolved from the token (`var(--color-triageit)` etc. — add a helper `accentVar(slug: string): string` exported from this file that returns `` `var(--color-${slug})` ``).
- [ ] **Step 2: Implement `mock-ui.tsx`** with the five primitives above, all pure presentational, no state.
- [ ] **Step 3: Temporarily render one `BrowserFrame` with a few primitives on `page.tsx`, run `npm run dev --workspace=gtools`, and view http://localhost:3002 to sanity-check the look (use webapp-testing skill for a screenshot if headless). Revert the temporary page change after checking.**
- [ ] **Step 4: Verify build passes:** `npx turbo build --filter=gtools` → success.
- [ ] **Step 5: Commit**

```bash
git add apps/gtools/src/components/browser-frame.tsx apps/gtools/src/components/mock-ui.tsx
git commit -m "feat: add browser frame and mock UI primitives"
```

---

### Task 4: Nav, Hero, SuiteGrid, Footer

**Files:**
- Create: `apps/gtools/src/components/nav.tsx`
- Create: `apps/gtools/src/components/hero.tsx`
- Create: `apps/gtools/src/components/suite-grid.tsx`
- Create: `apps/gtools/src/components/footer.tsx`
- Modify: `apps/gtools/src/app/page.tsx`

**Interfaces:**
- Consumes: `TOOLS` from `@/content/tools`; `accentVar` from `browser-frame.tsx`.
- Produces: `Nav()`, `Hero()`, `SuiteGrid()`, `Footer()` — all take no props (they import `TOOLS` directly). Section anchor convention (used by Tasks 5–7): each tool section id is the tool slug, e.g. `<section id="triageit">`; suite-grid cards and nav links point to `#<slug>`.

**Copy (verbatim):**
- Hero headline: `The software we built to run our MSP.`
- Hero subhead: `Gamma Tech Services didn't settle for off-the-shelf. GTools is the suite of eight products we engineered to triage tickets, stop attacks, reconcile billing, and keep clients informed — and it runs our helpdesk every day.`
- Nav CTA button text: `Contact us` → `mailto:help@gamma.tech`.
- Suite grid section heading: `Eight tools. One stack.`
- Footer: `Gamma Tech Services LLC · Naples, FL` + link `gamma.tech` → `https://gamma.tech` + `help@gamma.tech` mailto link.

- [ ] **Step 1: Implement `nav.tsx`** — sticky top, `backdrop-blur`, GTOOLS wordmark in `font-display` (render as `G`+`TOOLS` with the G in `text-brand`), tool names as anchor links (hidden below `lg:`), Contact button.
- [ ] **Step 2: Implement `hero.tsx`** — full-viewport-ish (`min-h-[80vh]`) centered hero, display type at `text-5xl md:text-7xl`, subhead in `text-fog max-w-2xl`, below it a badge strip of the 8 tool names as `MockPill`-style chips each dotted with its accent color, and a soft radial `--color-brand` glow behind the headline.
- [ ] **Step 3: Implement `suite-grid.tsx`** — heading + responsive grid (`sm:grid-cols-2 lg:grid-cols-4`), one card per tool: accent dot, `name`, `oneLiner`, subtle border, hover lift + accent border, wrapping `<a href={`#${tool.slug}`}>`.
- [ ] **Step 4: Implement `footer.tsx`** per copy above.
- [ ] **Step 5: Assemble in `page.tsx`:** `<Nav/><main><Hero/><SuiteGrid/></main><Footer/>`.
- [ ] **Step 6: Verify:** `npx turbo build --filter=gtools` passes; dev-render http://localhost:3002 and check hero, grid of 8, footer.
- [ ] **Step 7: Commit**

```bash
git add apps/gtools/src/components apps/gtools/src/app/page.tsx
git commit -m "feat: add nav, hero, suite grid, and footer"
```

---

### Task 5: "Better together" strip

**Files:**
- Create: `apps/gtools/src/components/better-together.tsx`
- Modify: `apps/gtools/src/app/page.tsx` (insert after `<SuiteGrid/>`)

**Interfaces:**
- Consumes: `accentVar` from `browser-frame.tsx`.
- Produces: `BetterTogether()` — no props.

**Copy (verbatim):**
- Heading: `Better together.`
- Body: `ConnectIT normalizes data from the platforms we already run — Halo PSA, Microsoft 365, Datto, JumpCloud — into one source of truth. QuoteIT, PortalIT, and ProjectIT build on it, so a customer looks the same in every tool.`

**Layout:** a simple three-tier diagram built with divs (not SVG): bottom row of 4 platform chips (Halo PSA, Microsoft 365, Datto, JumpCloud) → connecting vertical hairlines → center `ConnectIT` node (cyan accent border/glow) → hairlines up to 3 chips (QuoteIT, PortalIT, ProjectIT). Mobile: stack the three tiers vertically, hide connector lines.

- [ ] **Step 1: Implement the component per copy/layout above.**
- [ ] **Step 2: Add to `page.tsx` after `<SuiteGrid/>`.**
- [ ] **Step 3: Verify build + dev render.**
- [ ] **Step 4: Commit**

```bash
git add apps/gtools/src/components/better-together.tsx apps/gtools/src/app/page.tsx
git commit -m "feat: add better-together integration story strip"
```

---

### Task 6: Tool mockups (all 8) + registry with test (TDD)

**Files:**
- Create: `apps/gtools/src/components/mockups/{triageit,secureit,projectit,portalit,quoteit,connectit,runit,phoneit}.tsx`
- Create: `apps/gtools/src/components/mockups/index.ts`
- Create: `apps/gtools/src/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: primitives from `mock-ui.tsx` (Task 3), `MockupKey` from `@/content/types`.
- Produces: `MOCKUPS: Record<MockupKey, () => React.JSX.Element>` from `mockups/index.ts` — consumed by Task 7's `ToolSection`.

Each mockup is a small (<80 line) composition of primitives depicting the tool's signature screen. Fake data must be plausible but obviously demo (use "Acme Dental", "Coastal Law", "Naples Realty" as client names; no real client/tech names except none at all).

**Signature screens (what each must show):**
1. **triageit** — a ticket triage note: header row `Ticket #4821 · Acme Dental`, pills `Email / M365`, `Urgency 4`, `Security: clear`; a "Findings" panel with 3 short rows (e.g. `Mailbox rule forwarding externally — flagged`), footer row `Recommended: escalate to tech · respond < 1 hr`.
2. **secureit** — an incident report: title `Impossible travel — token replay suspected`, `Confidence: High` pill (bad tone), 3-step attack-chain rows, remediation button-row (`Revoke sessions`, `Disable account`, `Block IP`) rendered as small accent-bordered chips.
3. **projectit** — a mini board: 3 columns (`To do`, `In progress`, `Done`) each with 2 task cards (title + assignee initials + `MockBar` progress).
4. **portalit** — reconciliation dashboard: `MockStat` row (`MRR $48.2k`, `Discrepancies 7`, `Recovered $1,940/mo`), then a 3-row table `cells: [client, invoiced, actual, delta]` with one bad-tone delta.
5. **quoteit** — quote builder: quote header `Q-2047 · Coastal Law`, 3 line-item rows (item, qty, price), totals panel (`One-time $8,450`, `Monthly $1,275`), status pill `Awaiting signature`.
6. **connectit** — sync dashboard: `MockStat` row (`Connectors live 2`, `Records 128k`, `Customers 214`), recent-runs table, 3 rows: `[HaloPSA, ok-pill Success, 2m 14s]`, `[Twilio Lookup, ok Success, 41s]`, `[Datto RMM, neutral Queued, —]`.
7. **runit** — tool-grid dashboard: 4 tool tiles (`AutoDoc`, `File Migration`, `Lazybird TTS`, `TextIT`) each with a one-word status, plus a `Recent runs` list of 2 rows with ok pills.
8. **phoneit** — bulk lookup results: upload summary bar (`500 numbers · 494 OK · 6 failed`, `MockBar pct=98`), results table 3 rows `[number, caller name, carrier, line type]`.

- [ ] **Step 1: Write the failing registry test**

```ts
// apps/gtools/src/__tests__/registry.test.ts
import { describe, expect, it } from "vitest";
import { TOOLS } from "@/content/tools";
import { MOCKUPS } from "@/components/mockups";

describe("mockup registry", () => {
  it("has a mockup component for every tool", () => {
    for (const tool of TOOLS) {
      expect(MOCKUPS[tool.mockup], `missing mockup: ${tool.mockup}`).toBeTypeOf("function");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test --workspace=gtools` → FAIL (cannot resolve `@/components/mockups`).
- [ ] **Step 3: Implement the 8 mockup components** per the signature-screen specs, composing ONLY `mock-ui.tsx` primitives plus plain divs. Load frontend-design skill first.
- [ ] **Step 4: Create `mockups/index.ts`:**

```ts
import type { MockupKey } from "@/content/types";
import { TriageitMockup } from "./triageit";
import { SecureitMockup } from "./secureit";
import { ProjectitMockup } from "./projectit";
import { PortalitMockup } from "./portalit";
import { QuoteitMockup } from "./quoteit";
import { ConnectitMockup } from "./connectit";
import { RunitMockup } from "./runit";
import { PhoneitMockup } from "./phoneit";

export const MOCKUPS: Record<MockupKey, () => React.JSX.Element> = {
  triageit: TriageitMockup,
  secureit: SecureitMockup,
  projectit: ProjectitMockup,
  portalit: PortalitMockup,
  quoteit: QuoteitMockup,
  connectit: ConnectitMockup,
  runit: RunitMockup,
  phoneit: PhoneitMockup,
};
```

- [ ] **Step 5: Run tests to verify pass** — `npm test --workspace=gtools` → all green.
- [ ] **Step 6: Verify build** — `npx turbo build --filter=gtools` → success.
- [ ] **Step 7: Commit**

```bash
git add apps/gtools/src/components/mockups apps/gtools/src/__tests__/registry.test.ts
git commit -m "feat: add stylized product mockups for all 8 tools"
```

---

### Task 7: ToolSection + final page assembly

**Files:**
- Create: `apps/gtools/src/components/tool-section.tsx`
- Modify: `apps/gtools/src/app/page.tsx`

**Interfaces:**
- Consumes: `Tool` type, `MOCKUPS`, `BrowserFrame`, `accentVar`.
- Produces: `ToolSection({ tool, flip }: { tool: Tool; flip: boolean })`.

**Layout:** `<section id={tool.slug}>`, two-column at `lg:` (copy column + mockup column, order swapped when `flip`), stacked on mobile (copy first). Copy column: accent-colored kicker (tool name uppercase, small tracking-wide), `tagline` in display type `text-3xl md:text-4xl`, `description` in `text-fog`, feature list (accent tick dot + `title` bold + `blurb` in fog), integration pills row. Mockup column: `BrowserFrame` with `url={`${tool.slug}.gtools.io`}` and accent glow, containing `MOCKUPS[tool.mockup]`. When `tool.screenshotSrc` is set, `BrowserFrame` shows the screenshot instead (already handled in Task 3).

- [ ] **Step 1: Implement `tool-section.tsx`** per layout above.
- [ ] **Step 2: Final `page.tsx`:**

```tsx
import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { SuiteGrid } from "@/components/suite-grid";
import { BetterTogether } from "@/components/better-together";
import { ToolSection } from "@/components/tool-section";
import { Footer } from "@/components/footer";
import { TOOLS } from "@/content/tools";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <SuiteGrid />
        <BetterTogether />
        {TOOLS.map((tool, i) => (
          <ToolSection key={tool.slug} tool={tool} flip={i % 2 === 1} />
        ))}
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Verify** — `npm test --workspace=gtools` green; `npx turbo build --filter=gtools` success.
- [ ] **Step 4: Commit**

```bash
git add apps/gtools/src/components/tool-section.tsx apps/gtools/src/app/page.tsx
git commit -m "feat: assemble gtools landing page with all tool sections"
```

---

### Task 8: Full-page verification pass

**Files:** none new (fixes only, if issues found).

- [ ] **Step 1: Lint** — `npm run lint --workspace=gtools` → clean.
- [ ] **Step 2: Tests** — `npm test --workspace=gtools` → green.
- [ ] **Step 3: Production build** — `npx turbo build --filter=gtools` → success; confirm `/` is statically generated (`○ /` in build output).
- [ ] **Step 4: Playwright smoke (webapp-testing skill):** run `npm run start --workspace=gtools` (after build), then with Playwright: load http://localhost:3002, assert the h1 contains "The software we built", assert 8 `section[id]` elements matching the tool slugs exist, click a suite-grid card and confirm the URL hash changes, screenshot desktop (1440px) and mobile (390px) viewports for the PR.
- [ ] **Step 5: Review screenshots yourself** — check dark theme contrast, no horizontal overflow at 390px, mockups legible. Fix and re-verify anything broken.
- [ ] **Step 6: Commit any fixes** — `git add -A apps/gtools && git commit -m "fix: polish gtools page after smoke pass"` (skip if no changes).

---

### Task 9: Railway config + draft PR

**Files:**
- Create: `apps/gtools/railway.json`
- Create: `apps/gtools/README.md`

- [ ] **Step 1: Create railway.json**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npx turbo build --filter=gtools"
  },
  "deploy": {
    "startCommand": "npm run start --workspace=gtools",
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

- [ ] **Step 2: Create README.md**

```markdown
# gtools — gtools.io promotional site

Static single-page showcase of the Gamma Tech tool suite. No env vars, no database.

## Develop
npm run dev --workspace=gtools   # http://localhost:3002

## Deploy (Railway — TriageIT project)
1. New service "gtools" from this GitHub repo.
2. Settings → Config file path: `apps/gtools/railway.json`.
3. Settings → Watch paths: `apps/gtools/**`, `packages/**`.
4. Settings → Networking → Custom domain: `gtools.io` (apex only — no www).
5. Cloudflare DNS: flattened CNAME on the apex pointing at the Railway domain, DNS-only or proxied per preference.

## Content edits
All copy lives in `src/content/tools.ts`. To swap a CSS mockup for a real
screenshot, add the image under `public/screenshots/` and set `screenshotSrc`
on that tool.
```

- [ ] **Step 3: Commit**

```bash
git add apps/gtools/railway.json apps/gtools/README.md
git commit -m "chore: add railway config and readme for gtools service"
```

- [ ] **Step 4: Push branch and open draft PR** (base: `production`)

```bash
git push -u origin worktree-gtools-site
gh pr create --draft --base production --title "feat: gtools.io promotional site" --body "<summary per git-workflow rules, incl. test plan + desktop/mobile screenshots from Task 8>"
```
