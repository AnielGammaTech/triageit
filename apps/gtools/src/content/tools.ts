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
