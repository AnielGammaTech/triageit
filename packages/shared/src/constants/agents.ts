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
    integration: null,
    model: "haiku",
    description:
      "Runs DNS diagnostics and WHOIS lookups for email-related tickets: MX records, SPF, DKIM, DMARC validation, domain registration, and expiry checks. Uses free Google DNS API and RDAP — no API key needed.",
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
    role: "backup_recovery",
    specialty: "Cove, Unitrends & Backup Recovery",
    integration: "cove",
    model: "haiku",
    description:
      "Queries Cove Data Protection (N-able) for device backup status, last backup times, errors, and protection coverage. Provides deep expertise on Cove, Unitrends, and general backup/recovery procedures.",
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
    role: "voip",
    specialty: "VoIP & Telephony (3CX + Twilio)",
    integration: "threecx",
    model: "haiku",
    description:
      "Queries 3CX for system status, trunk registrations, extensions, and call logs. Also checks Twilio for SIP trunks, failed calls, and number config. Accurately scopes issues — a single trunk 404 is NOT a system-wide outage.",
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
    role: "backup",
    specialty: "Backup & Recovery (Spanning)",
    integration: "spanning",
    model: "haiku",
    description:
      "Queries Spanning Backup for Office 365 to check tenant backup status, user protection, error codes, and recovery points. Correlates ticket details with real backup data.",
  },
  {
    name: "erin_hannon",
    character: "Erin Hannon",
    role: "alert_specialist",
    specialty: "Alert Triage & Quick Summary",
    integration: null,
    model: "haiku",
    description:
      "The Receptionist. Handles automated alert tickets (Spanning, 3CX, Datto, monitoring alerts) cheaply and quickly. Produces a concise summary without deploying expensive specialist agents.",
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
  "meredith_palmer",
  "kelly_kapoor",
] as const;
