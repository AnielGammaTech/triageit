import type { Tool } from "./types";

export const TOOLS_B: readonly Tool[] = [
  {
    slug: "accountit",
    name: "AccountIT",
    oneLiner: "The standalone CRM for customer success",
    tagline: "The CRM that knows when a deal goes cold.",
    description:
      "AccountIT is a standalone customer-success CRM for accounts, QBRs, pipeline, and contract risk — with one-click jump into QuoteIT the moment a deal needs a proposal. No re-entering data, no second system of record for the deal.",
    features: [
      {
        title: "QBR cadence, prioritized",
        blurb:
          "Every account gets one next action — prep an upcoming review or catch up on one that's overdue, ranked by how far past cadence it is.",
      },
      {
        title: "Behavior-driven win scoring",
        blurb:
          "Every open deal scored nightly from stage, activity recency, and real quote-view and email-open engagement.",
      },
      {
        title: "One-click lead-to-quote",
        blurb:
          "Any lead jumps straight into a pre-filled QuoteIT proposal, and every quote view feeds back into deal health.",
      },
      {
        title: "Full account 360°",
        blurb:
          "Customers, contacts, and contracts with renewal tracking, MRR, QBRs, and opportunity-template playbooks.",
      },
    ],
    integrations: ["Halo PSA", "QuickBooks", "Microsoft Teams", "QuoteIT"],
    accent: "accountit",
    mockup: "accountit",
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
  {
    slug: "vendit",
    name: "VendIT",
    oneLiner: "QR-code vending machine payments",
    tagline: "A payment terminal in every QR code.",
    description:
      "VendIT turns any product into unattended checkout — customers scan a QR code and pay through Stripe Checkout, with card fees automatically grossed up so the operator nets the sticker price every time.",
    features: [
      {
        title: "Dual purchase flows",
        blurb:
          "A single-item QR buy page, a multi-item storefront with cart, and an in-person POS mode for card or cash.",
      },
      {
        title: "Automatic fee gross-up",
        blurb:
          "Stripe's card fee is shown as its own line item at a configurable rate, so margins stay protected.",
      },
      {
        title: "Barcode-driven inventory",
        blurb:
          "A camera barcode scanner with live UPC/EAN lookup auto-fills name, brand, and image on restock.",
      },
      {
        title: "Sales analytics & labels",
        blurb:
          "Today, 7-day, and all-time net and profit, a void/refund workflow, and one-click printable QR label sheets.",
      },
    ],
    integrations: ["Stripe Checkout", "Apple Pay", "Google Pay"],
    accent: "vendit",
    mockup: "vendit",
  },
] as const;
