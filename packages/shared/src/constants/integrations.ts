import type { IntegrationDefinition } from "../types/integration";

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
] as const;
