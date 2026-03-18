import type { AgentDefinition } from "../types/agent.js";

export const AGENTS: ReadonlyArray<AgentDefinition> = [
  {
    name: "michael_scott",
    character: "Michael Scott",
    role: "manager",
    specialty: "Triage Orchestrator",
    integration: "halo",
    model: "opus",
    description:
      "The Regional Manager. Analyzes incoming tickets, delegates to specialist agents, synthesizes all findings, and makes the final triage decision. Communicates results back to Halo PSA.",
  },
  {
    name: "dwight_schrute",
    character: "Dwight Schrute",
    role: "documentation",
    specialty: "IT Documentation & Assets",
    integration: "hudu",
    model: "haiku",
    description:
      "Assistant to the Regional Manager. Searches Hudu for client assets, passwords, KB articles, procedures, and any existing documentation relevant to the ticket.",
  },
  {
    name: "jim_halpert",
    character: "Jim Halpert",
    role: "identity",
    specialty: "User & Device Identity",
    integration: "jumpcloud",
    model: "haiku",
    description:
      "Checks JumpCloud for user identity, MFA enrollment status, device associations, group memberships, and policy compliance.",
  },
  {
    name: "pam_beesly",
    character: "Pam Beesly",
    role: "communications",
    specialty: "Response Drafting & Communications",
    integration: "halo",
    model: "sonnet",
    description:
      "Drafts client-facing responses and internal technician notes based on the triage findings. Ensures clear, professional communication.",
  },
  {
    name: "ryan_howard",
    character: "Ryan Howard",
    role: "classifier",
    specialty: "Ticket Classification & Priority",
    integration: null,
    model: "haiku",
    description:
      "Classifies ticket type (network, security, endpoint, cloud, email, etc.), extracts key entities, detects urgency signals, and scores priority 1-5.",
  },
  {
    name: "andy_bernard",
    character: "Andy Bernard",
    role: "endpoint",
    specialty: "Device Monitoring & RMM",
    integration: "datto",
    model: "haiku",
    description:
      "Queries Datto RMM for device status, open alerts, patch compliance, software inventory, and recent monitoring events related to the ticket.",
  },
  {
    name: "stanley_hudson",
    character: "Stanley Hudson",
    role: "cloud",
    specialty: "Cloud Infrastructure",
    integration: "vultr",
    model: "haiku",
    description:
      "Checks Vultr for cloud instance status, bandwidth usage, DNS records, and firewall configurations relevant to the reported issue.",
  },
  {
    name: "phyllis_vance",
    character: "Phyllis Vance",
    role: "dns_email",
    specialty: "Email & DNS Diagnostics",
    integration: "mxtoolbox",
    model: "haiku",
    description:
      "Runs MX Toolbox diagnostics for email-related tickets: MX records, SPF, DKIM, DMARC validation, blacklist checks, and SMTP connectivity tests.",
  },
  {
    name: "angela_martin",
    character: "Angela Martin",
    role: "security",
    specialty: "Security Assessment",
    integration: null,
    model: "haiku",
    description:
      "Analyzes all gathered findings for security implications. Flags potential security incidents, compromised accounts, or vulnerabilities that require immediate escalation.",
  },
  {
    name: "oscar_martinez",
    character: "Oscar Martinez",
    role: "reporting",
    specialty: "Financial & SLA Reporting",
    integration: null,
    model: "haiku",
    description:
      "Tracks SLA compliance, calculates cost metrics, and provides reporting data for triage accuracy and processing performance.",
  },
  {
    name: "kevin_malone",
    character: "Kevin Malone",
    role: "patches",
    specialty: "Patch Compliance",
    integration: "datto",
    model: "haiku",
    description:
      "Focused on patch management status. Checks missing Windows updates, patch policy compliance, and identifies devices at risk due to outdated software.",
  },
  {
    name: "kelly_kapoor",
    character: "Kelly Kapoor",
    role: "notifications",
    specialty: "Alert & Notification Routing",
    integration: null,
    model: "haiku",
    description:
      "Handles escalation rules, notification delivery, and ensures the right people are alerted based on ticket severity and type.",
  },
  {
    name: "toby_flenderson",
    character: "Toby Flenderson",
    role: "compliance",
    specialty: "Compliance & Audit",
    integration: null,
    model: "haiku",
    description:
      "Reviews triage actions for compliance with internal policies, maintains audit logs, and flags any compliance concerns.",
  },
  {
    name: "meredith_palmer",
    character: "Meredith Palmer",
    role: "legacy",
    specialty: "Legacy & Edge Cases",
    integration: null,
    model: "haiku",
    description:
      "Handles unusual ticket types that don't fit standard categories, legacy system issues, and edge cases that other agents can't classify.",
  },
] as const;

export const PHASE_1_AGENTS = ["michael_scott", "ryan_howard"] as const;
export const PHASE_2_AGENTS = [
  "dwight_schrute",
  "jim_halpert",
  "pam_beesly",
] as const;
export const PHASE_3_AGENTS = [
  "andy_bernard",
  "stanley_hudson",
  "phyllis_vance",
  "angela_martin",
  "kevin_malone",
] as const;
