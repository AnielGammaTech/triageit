export interface AdminMenuItem {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly iconBg: string;
  readonly iconColor: string;
}

export interface IntegrationItem {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly service: string;
  readonly iconBg: string;
  readonly iconColor: string;
}

export interface MenuGroup {
  readonly title: string;
  readonly items: ReadonlyArray<AdminMenuItem>;
}

export const MENU_GROUPS: ReadonlyArray<MenuGroup> = [
  {
    title: "People",
    items: [
      {
        id: "users",
        label: "Users & Security",
        desc: "Manage admin accounts and permissions",
        iconBg: "bg-violet-500/10",
        iconColor: "text-violet-400",
      },
    ],
  },
  {
    title: "Appearance",
    items: [
      {
        id: "branding",
        label: "Branding",
        desc: "Logo, colors, and portal name",
        iconBg: "bg-pink-500/10",
        iconColor: "text-pink-400",
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      {
        id: "integrations",
        label: "Integrations",
        desc: "PSA, RMM, identity & cloud services",
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      },
    ],
  },
  {
    title: "Triage Settings",
    items: [
      {
        id: "triage-rules",
        label: "Triage Rules",
        desc: "Configure classification and routing rules",
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-400",
      },
      {
        id: "agent-config",
        label: "Agent Configuration",
        desc: "AI model selection and agent behavior",
        iconBg: "bg-cyan-500/10",
        iconColor: "text-cyan-400",
      },
    ],
  },
];

export const INTEGRATION_CATEGORIES: ReadonlyArray<{
  readonly category: string;
  readonly items: ReadonlyArray<IntegrationItem>;
}> = [
  {
    category: "PSA & Ticketing",
    items: [
      {
        id: "halo",
        label: "Halo PSA",
        desc: "Ticket intake, triage output, and internal notes",
        service: "halo",
        iconBg: "bg-indigo-500/10",
        iconColor: "text-indigo-400",
      },
    ],
  },
  {
    category: "IT Documentation",
    items: [
      {
        id: "hudu",
        label: "Hudu",
        desc: "Asset documentation, passwords, and KB articles",
        service: "hudu",
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      },
    ],
  },
  {
    category: "RMM & Security",
    items: [
      {
        id: "datto",
        label: "Datto RMM",
        desc: "Device monitoring, alerts, and patch compliance",
        service: "datto",
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-400",
      },
      {
        id: "datto-edr",
        label: "Datto EDR",
        desc: "Endpoint detection & response",
        service: "datto-edr",
        iconBg: "bg-cyan-500/10",
        iconColor: "text-cyan-400",
      },
      {
        id: "rocketcyber",
        label: "RocketCyber SOC",
        desc: "Security incidents and alerts",
        service: "rocketcyber",
        iconBg: "bg-orange-500/10",
        iconColor: "text-orange-400",
      },
      {
        id: "unifi",
        label: "UniFi Network",
        desc: "UniFi Site Manager API for network devices and alerts",
        service: "unifi",
        iconBg: "bg-sky-500/10",
        iconColor: "text-sky-400",
      },
      {
        id: "vpentest",
        label: "vPenTest",
        desc: "Automated network penetration testing",
        service: "vpentest",
        iconBg: "bg-rose-500/10",
        iconColor: "text-rose-400",
      },
    ],
  },
  {
    category: "SaaS Security",
    items: [
      {
        id: "saas-alerts",
        label: "SaaS Alerts",
        desc: "Monitor SaaS app security events",
        service: "saas-alerts",
        iconBg: "bg-violet-500/10",
        iconColor: "text-violet-400",
      },
    ],
  },
  {
    category: "Identity & Access",
    items: [
      {
        id: "jumpcloud",
        label: "JumpCloud",
        desc: "User identity, MFA, device associations",
        service: "jumpcloud",
        iconBg: "bg-green-500/10",
        iconColor: "text-green-400",
      },
    ],
  },
  {
    category: "Backup & Recovery",
    items: [
      {
        id: "unitrends",
        label: "Unitrends",
        desc: "Sync backup data from Unitrends MSP",
        service: "unitrends",
        iconBg: "bg-purple-500/10",
        iconColor: "text-purple-400",
      },
      {
        id: "cove",
        label: "Cove Data Protection",
        desc: "Sync backup devices from N-able Cove",
        service: "cove",
        iconBg: "bg-teal-500/10",
        iconColor: "text-teal-400",
      },
    ],
  },
  {
    category: "Marketplace & Licensing",
    items: [
      {
        id: "pax8",
        label: "Pax8",
        desc: "Microsoft 365, Azure & cloud subscriptions",
        service: "pax8",
        iconBg: "bg-pink-500/10",
        iconColor: "text-pink-400",
      },
    ],
  },
  {
    category: "Email & DNS",
    items: [
      {
        id: "mxtoolbox",
        label: "MX Toolbox",
        desc: "MX, SPF, DKIM, DMARC, blacklist diagnostics",
        service: "mxtoolbox",
        iconBg: "bg-orange-500/10",
        iconColor: "text-orange-400",
      },
      {
        id: "dmarc",
        label: "DMARC Report",
        desc: "Domain DMARC compliance monitoring",
        service: "dmarc",
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      },
    ],
  },
  {
    category: "VoIP & Cloud",
    items: [
      {
        id: "threecx",
        label: "3CX",
        desc: "Per-customer VoIP extension sync",
        service: "threecx",
        iconBg: "bg-emerald-500/10",
        iconColor: "text-emerald-400",
      },
      {
        id: "vultr",
        label: "Vultr",
        desc: "Server status, bandwidth, DNS, and firewalls",
        service: "vultr",
        iconBg: "bg-indigo-500/10",
        iconColor: "text-indigo-400",
      },
    ],
  },
  {
    category: "Microsoft 365 Management",
    items: [
      {
        id: "cipp",
        label: "CIPP",
        desc: "Microsoft 365 management via CyberDrain",
        service: "cipp",
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-400",
      },
    ],
  },
  {
    category: "Notifications & Output",
    items: [
      {
        id: "teams",
        label: "Microsoft Teams",
        desc: "Daily triage summaries and alerts to Teams",
        service: "teams",
        iconBg: "bg-indigo-500/10",
        iconColor: "text-indigo-400",
      },
    ],
  },
  {
    category: "AI & Automation",
    items: [
      {
        id: "ai-provider",
        label: "AI Provider",
        desc: "Claude, OpenAI, and Moonshot Kimi API keys",
        service: "ai-provider",
        iconBg: "bg-amber-500/10",
        iconColor: "text-amber-400",
      },
    ],
  },
];
