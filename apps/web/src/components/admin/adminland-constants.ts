export interface AdminSection {
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

export const ADMIN_SECTIONS: ReadonlyArray<{
  readonly category: string;
  readonly items: ReadonlyArray<AdminSection>;
}> = [
  {
    category: "People",
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
    category: "Appearance",
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
    category: "Triage Settings",
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
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-400",
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
    category: "RMM & Monitoring",
    items: [
      {
        id: "datto",
        label: "Datto RMM",
        desc: "Device monitoring, alerts, and patch compliance",
        service: "datto",
        iconBg: "bg-sky-500/10",
        iconColor: "text-sky-400",
      },
    ],
  },
  {
    category: "Cloud Infrastructure",
    items: [
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
    ],
  },
];
