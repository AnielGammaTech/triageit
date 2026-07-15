import type { Tool } from "./types";

export const TOOLS_A: readonly Tool[] = [
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
    oneLiner: "The client transparency portal",
    tagline: "Radical transparency with your MSP.",
    description:
      "PortalIT gives every client a branded login to see exactly what Gamma Tech manages for them — services, licenses, invoices, quotes, and support — backed by live vendor data instead of a black box. It's the transparency most MSPs never give you.",
    features: [
      {
        title: "Live service visibility",
        blurb:
          "Every managed service and license shown in real time, straight from the vendor — not a static PDF nobody reads.",
      },
      {
        title: "Invoices you can trust",
        blurb:
          "Every bill is reconciled against real usage before it reaches you, so what you're charged is what you actually run.",
      },
      {
        title: "Quotes & support, one login",
        blurb:
          "Track quote approvals and open support tickets without the email back-and-forth.",
      },
      {
        title: "Powered by 40+ vendor syncs",
        blurb:
          "The same live data engine that keeps your MSP honest on billing is the data your portal shows you.",
      },
    ],
    integrations: ["Halo PSA", "Pax8", "Datto", "JumpCloud", "Microsoft 365"],
    accent: "portalit",
    mockup: "portalit",
  },
  {
    slug: "lootit",
    name: "LootIT",
    oneLiner: "Deep-audit billing reconciliation",
    tagline: "Every invoice audited. Every dollar found.",
    description:
      "LootIT is PortalIT's deep-audit companion — a standalone reconciliation tool that cross-checks every PSA recurring-billing line item against live vendor usage across Datto, Cove, JumpCloud, RocketCyber, Pax8, 3CX, and more, catching over- and under-billing before invoices go out.",
    features: [
      {
        title: "Reconciliation work queue",
        blurb:
          "Customer roster with Issues/Matched/Signed Off/Pending filters, plus a collapsible billing-anomalies panel.",
      },
      {
        title: "Line-by-line workbench",
        blurb:
          "Verify PSA quantities against vendor usage, force-match exceptions, and auto-extract pricing from uploaded contracts.",
      },
      {
        title: "Formal sign-off workflow",
        blurb:
          "Every reconciliation moves from In Progress to Ready to Sign to a snapshotted, signed-off packet.",
      },
      {
        title: "Configurable anomaly alerts",
        blurb:
          "Matching rules plus dollar- and percent-based email alerts flag billing drift the moment it appears.",
      },
    ],
    integrations: ["Halo PSA", "Datto", "Cove", "JumpCloud", "Pax8"],
    accent: "lootit",
    mockup: "lootit",
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
] as const;
