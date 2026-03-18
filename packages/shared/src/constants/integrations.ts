import type { IntegrationDefinition } from "../types/integration.js";

export const INTEGRATION_DEFINITIONS: ReadonlyArray<IntegrationDefinition> = [
  {
    service: "halo",
    display_name: "Halo PSA",
    description:
      "Primary ticketing system. Receives tickets via webhook and writes back triage results as notes.",
    fields: [
      {
        key: "base_url",
        label: "Base URL",
        type: "url",
        placeholder: "https://your-instance.halopsa.com",
        required: true,
      },
      {
        key: "client_id",
        label: "Client ID",
        type: "text",
        placeholder: "Your OAuth Client ID",
        required: true,
      },
      {
        key: "client_secret",
        label: "Client Secret",
        type: "password",
        placeholder: "Your OAuth Client Secret",
        required: true,
      },
      {
        key: "tenant",
        label: "Tenant (optional)",
        type: "text",
        placeholder: "Tenant name for hosted instances",
        required: false,
      },
    ],
  },
  {
    service: "hudu",
    display_name: "Hudu",
    description:
      "IT documentation platform. Provides asset info, passwords, KB articles, and procedures.",
    fields: [
      {
        key: "base_url",
        label: "Base URL",
        type: "url",
        placeholder: "https://your-instance.hudu.com",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Hudu API Key",
        required: true,
      },
    ],
  },
  {
    service: "datto",
    display_name: "Datto RMM",
    description:
      "Remote monitoring & management. Provides device status, alerts, patch compliance, and software inventory.",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        type: "url",
        placeholder: "https://pinotage-api.centrastage.net",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "text",
        placeholder: "Your Datto RMM API Key",
        required: true,
      },
      {
        key: "api_secret",
        label: "API Secret",
        type: "password",
        placeholder: "Your Datto RMM API Secret",
        required: true,
      },
    ],
  },
  {
    service: "datto-edr",
    display_name: "Datto EDR",
    description:
      "Endpoint detection & response. Monitors endpoint threats, suspicious processes, and lateral movement.",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        type: "url",
        placeholder: "https://edr-api.datto.com",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Datto EDR API Key",
        required: true,
      },
    ],
  },
  {
    service: "rocketcyber",
    display_name: "RocketCyber SOC",
    description:
      "Managed SOC platform. Provides security incidents, alerts, and threat intelligence.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your RocketCyber API Key",
        required: true,
      },
      {
        key: "msp_account_id",
        label: "MSP Account ID",
        type: "text",
        placeholder: "Your MSP Account ID",
        required: true,
      },
    ],
  },
  {
    service: "unifi",
    display_name: "UniFi Network",
    description:
      "Network infrastructure. Sync firewalls, switches, access points, and client devices.",
    fields: [
      {
        key: "controller_url",
        label: "Controller URL",
        type: "url",
        placeholder: "https://unifi.your-domain.com",
        required: true,
      },
      {
        key: "username",
        label: "Username",
        type: "text",
        placeholder: "UniFi controller username",
        required: true,
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "UniFi controller password",
        required: true,
      },
    ],
  },
  {
    service: "vpentest",
    display_name: "vPenTest",
    description:
      "Automated network penetration testing. Provides vulnerability assessment and compliance reports.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your vPenTest API Key",
        required: true,
      },
    ],
  },
  {
    service: "saas-alerts",
    display_name: "SaaS Alerts",
    description:
      "SaaS security monitoring. Detects unusual user behavior, unauthorized access, and data exfiltration.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your SaaS Alerts API Key",
        required: true,
      },
    ],
  },
  {
    service: "jumpcloud",
    display_name: "JumpCloud",
    description:
      "Directory & IAM platform. Provides user identity, MFA status, device associations, and group policies.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your JumpCloud API Key",
        required: true,
      },
    ],
  },
  {
    service: "unitrends",
    display_name: "Unitrends",
    description:
      "Backup & disaster recovery. Sync backup job status, protected assets, and recovery points.",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        type: "url",
        placeholder: "https://api.unitrends.com",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Unitrends API Key",
        required: true,
      },
    ],
  },
  {
    service: "cove",
    display_name: "Cove Data Protection",
    description:
      "Cloud backup monitoring from N-able Cove. Sync backup devices, job status, and storage usage.",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        type: "url",
        placeholder: "https://api.backup.management",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Cove API Key",
        required: true,
      },
      {
        key: "partner_id",
        label: "Partner ID",
        type: "text",
        placeholder: "Your partner/MSP ID",
        required: true,
      },
    ],
  },
  {
    service: "pax8",
    display_name: "Pax8",
    description:
      "Cloud marketplace. Sync Microsoft 365, Azure, and other cloud subscription data.",
    fields: [
      {
        key: "client_id",
        label: "Client ID",
        type: "text",
        placeholder: "Your Pax8 Client ID",
        required: true,
      },
      {
        key: "client_secret",
        label: "Client Secret",
        type: "password",
        placeholder: "Your Pax8 Client Secret",
        required: true,
      },
    ],
  },
  {
    service: "darkweb",
    display_name: "Dark Web ID",
    description:
      "Dark web monitoring. Detects compromised credentials and personal data on the dark web.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Dark Web ID API Key",
        required: true,
      },
    ],
  },
  {
    service: "bullphish",
    display_name: "BullPhish ID",
    description:
      "Phishing simulation & security awareness training. Track campaign results and user susceptibility.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your BullPhish ID API Key",
        required: true,
      },
    ],
  },
  {
    service: "inky",
    display_name: "Inky",
    description:
      "Email protection platform. Provides phishing detection, impersonation alerts, and email threat reports.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Inky API Key",
        required: true,
      },
    ],
  },
  {
    service: "mxtoolbox",
    display_name: "MX Toolbox",
    description:
      "Email & DNS diagnostics. Provides MX, SPF, DKIM, DMARC checks, blacklist monitoring, and SMTP tests.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your MX Toolbox API Key",
        required: true,
      },
    ],
  },
  {
    service: "dmarc",
    display_name: "DMARC Report",
    description:
      "Domain DMARC compliance monitoring. Aggregate and forensic report analysis.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your DMARC Report API Key",
        required: true,
      },
    ],
  },
  {
    service: "threecx",
    display_name: "3CX",
    description:
      "VoIP phone system. Per-customer extension sync, call logs, and system status.",
    fields: [
      {
        key: "api_url",
        label: "API URL",
        type: "url",
        placeholder: "https://your-3cx.example.com",
        required: true,
      },
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your 3CX API Key",
        required: true,
      },
    ],
  },
  {
    service: "vultr",
    display_name: "Vultr",
    description:
      "Cloud hosting platform. Provides server status, bandwidth metrics, DNS, and firewall configuration.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Vultr API Key",
        required: true,
      },
    ],
  },
  {
    service: "ai-provider",
    display_name: "AI Provider",
    description:
      "Configure AI providers for triage agents. Enable one or more providers and set API keys.",
    fields: [
      {
        key: "default_provider",
        label: "Default Provider",
        type: "select",
        placeholder: "Select default AI provider",
        required: true,
        options: [
          { value: "claude", label: "Claude (Anthropic)" },
          { value: "openai", label: "OpenAI" },
          { value: "moonshot", label: "Moonshot Kimi" },
        ],
      },
      {
        key: "claude_api_key",
        label: "Claude API Key (Anthropic)",
        type: "password",
        placeholder: "sk-ant-...",
        required: false,
      },
      {
        key: "openai_api_key",
        label: "OpenAI API Key",
        type: "password",
        placeholder: "sk-...",
        required: false,
      },
      {
        key: "moonshot_api_key",
        label: "Moonshot Kimi API Key",
        type: "password",
        placeholder: "Your Moonshot API Key",
        required: false,
      },
    ],
  },
] as const;
