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
      "UniFi Site Manager API. Query network devices, alerts, site health, and client activity across all your sites.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Create at unifi.ui.com → Settings → API Keys",
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
      "Directory & IAM platform (MTP). Provides user identity, MFA status, device associations, and group policies across all managed organizations.",
    fields: [
      {
        key: "api_key",
        label: "Provider API Key",
        type: "password",
        placeholder: "Your JumpCloud MTP provider API key",
        required: true,
      },
      {
        key: "provider_id",
        label: "Provider ID",
        type: "text",
        placeholder: "Your JumpCloud MTP Provider ID",
        required: true,
      },
    ],
  },
  {
    service: "unitrends",
    display_name: "Unitrends",
    description:
      "Kaseya-powered backup & disaster recovery. Sync backup job status, protected assets, and recovery points.",
    fields: [
      {
        key: "client_id",
        label: "Client ID",
        type: "text",
        placeholder: "Your Unitrends / Kaseya Client ID",
        required: true,
      },
      {
        key: "client_secret",
        label: "Client Secret",
        type: "password",
        placeholder: "Your Unitrends / Kaseya Client Secret",
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
        key: "partner_name",
        label: "API Partner Name",
        type: "text",
        placeholder: "Your Cove partner/company name",
        required: true,
      },
      {
        key: "api_username",
        label: "API Username",
        type: "text",
        placeholder: "Your Cove API username",
        required: true,
      },
      {
        key: "api_token",
        label: "API Token",
        type: "password",
        placeholder: "Your Cove API token",
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
    service: "twilio",
    display_name: "Twilio",
    description:
      "Cloud communications platform. Provides call logs, SMS history, SIP trunking status, number management, and call quality metrics.",
    fields: [
      {
        key: "account_sid",
        label: "Account SID",
        type: "text",
        placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        required: true,
      },
      {
        key: "auth_token",
        label: "Auth Token",
        type: "password",
        placeholder: "Your Twilio Auth Token",
        required: true,
      },
    ],
  },
  {
    service: "spanning",
    display_name: "Spanning Backup",
    description:
      "Cloud-to-cloud backup for Microsoft 365. Monitors backup status, user protection, error logs, and recovery points.",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "Your Spanning API Key (Bearer token)",
        required: true,
      },
      {
        key: "region",
        label: "Region",
        type: "text",
        placeholder: "us, eu, or ap",
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
  {
    service: "teams",
    display_name: "Microsoft Teams",
    description:
      "Daily triage summaries and alerts. Posts re-triage reports, SLA warnings, and stale ticket alerts to your Teams channel.",
    fields: [
      {
        key: "webhook_url",
        label: "Incoming Webhook URL",
        type: "url",
        placeholder: "https://outlook.office.com/webhook/...",
        required: true,
      },
      {
        key: "channel_name",
        label: "Channel Name (for display)",
        type: "text",
        placeholder: "e.g. #triage-alerts",
        required: false,
      },
    ],
  },
  {
    service: "cipp",
    display_name: "CIPP",
    description:
      "Microsoft 365 management via CyberDrain Improved Partner Portal. User info, mailbox status, MFA, licenses, device compliance, and tenant health.",
    fields: [
      {
        key: "cippApiUrl",
        label: "cippApiUrl",
        type: "url",
        placeholder: "https://your-cipp-instance.azurewebsites.net",
        required: true,
      },
      {
        key: "cippAuthScope",
        label: "cippAuthScope",
        type: "password",
        placeholder: "api://your-app-id/.default",
        required: true,
      },
      {
        key: "cippAuthClientId",
        label: "cippAuthClientId",
        type: "password",
        placeholder: "Azure AD Application (Client) ID",
        required: true,
      },
      {
        key: "cippAuthTokenUrl",
        label: "cippAuthTokenUrl",
        type: "password",
        placeholder: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        required: true,
      },
      {
        key: "cippAuthClientSecret",
        label: "cippAuthClientSecret",
        type: "password",
        placeholder: "Azure AD Client Secret",
        required: true,
      },
    ],
  },
] as const;
