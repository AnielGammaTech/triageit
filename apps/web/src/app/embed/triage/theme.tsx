/**
 * TriageIT embed design system — "Tactical SOC console".
 * Server-safe: no hooks, importable from both server and client components.
 */

// ── Tokens ──────────────────────────────────────────────────────────────

export const T = {
  // Surfaces (layered depth)
  bg: "#06070b",
  surface1: "#0c0e15",
  surface2: "#11141d",
  surface3: "#171b28",

  // Hairlines
  line: "rgba(140,150,190,0.10)",
  lineSoft: "rgba(140,150,190,0.06)",
  lineStrong: "rgba(140,150,190,0.18)",

  // Text
  text: "#e8eaf2",
  textSoft: "#98a0b8",
  textMute: "#5c6480",
  textFaint: "#3a4058",

  // Brand
  brand: "#8b7cff",
  brandDeep: "#6c5ce7",

  // Status
  green: "#3ddc84",
  amber: "#f5c84c",
  orange: "#ff8a3d",
  red: "#ff4d5e",
  teal: "#2dd4bf",
  blue: "#60a5fa",
  pink: "#f472b6",
  gray: "#7a8194",

  // Type
  mono: "'IBM Plex Mono', 'SF Mono', monospace",
  sans: "'IBM Plex Sans', 'Inter', system-ui, sans-serif",
} as const;

export const PRIORITY_THEME: Record<
  number,
  { label: string; color: string; glow: string }
> = {
  1: { label: "Critical", color: T.red, glow: "rgba(255,77,94,0.35)" },
  2: { label: "High", color: T.orange, glow: "rgba(255,138,61,0.30)" },
  3: { label: "Medium", color: T.amber, glow: "rgba(245,200,76,0.25)" },
  4: { label: "Low", color: T.green, glow: "rgba(61,220,132,0.22)" },
  5: { label: "Minimal", color: T.gray, glow: "rgba(122,129,148,0.18)" },
};

export const urgencyColor = (score: number): string =>
  score >= 4 ? T.red : score >= 3 ? T.amber : T.green;

// ── Icons (Lucide-style, stroke-based, 24 viewBox) ──────────────────────

interface IconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly style?: React.CSSProperties;
}

function icon(paths: React.ReactNode) {
  return function Icon({ size = 14, color = "currentColor", strokeWidth = 2, style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };
}

export const IconShield = icon(
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
);

export const IconShieldAlert = icon(
  <>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>,
);

export const IconZap = icon(
  <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />,
);

export const IconRefresh = icon(
  <>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </>,
);

export const IconSparkles = icon(
  <>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
  </>,
);

export const IconClipboardCheck = icon(
  <>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </>,
);

export const IconCopy = icon(
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
);

export const IconReply = icon(
  <>
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    <path d="m9 17-5-5 5-5" />
  </>,
);

export const IconBook = icon(
  <>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
  </>,
);

export const IconBot = icon(
  <>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </>,
);

export const IconChevron = icon(<path d="m9 18 6-6-6-6" />);

export const IconClock = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>,
);

export const IconCpu = icon(
  <>
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" />
    <path d="M15 2v2" />
    <path d="M15 20v2" />
    <path d="M2 15h2" />
    <path d="M2 9h2" />
    <path d="M20 15h2" />
    <path d="M20 9h2" />
    <path d="M9 2v2" />
    <path d="M9 20v2" />
  </>,
);

export const IconActivity = icon(
  <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
);

export const IconBrain = icon(
  <>
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
  </>,
);

export const IconNote = icon(
  <>
    <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.6a2 2 0 0 0-.59-1.41l-4.6-4.6A2 2 0 0 0 13.4 2Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </>,
);

export const IconUsers = icon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

export const IconRadar = icon(
  <>
    <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
    <path d="M4 6h.01" />
    <path d="M2.29 9.62a10 10 0 1 0 19.02-1.27" />
    <path d="M16.24 7.76a6 6 0 1 0-8.01 8.91" />
    <path d="M12 18h.01" />
    <path d="M17.99 11.66a6 6 0 0 1-2.22 4.75" />
    <circle cx="12" cy="12" r="2" />
    <path d="m13.41 10.59 5.66-5.66" />
  </>,
);

export const IconAlertTriangle = icon(
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>,
);

export const IconPaperclip = icon(
  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
);

// ── Confidence Ring (SVG circular progress) ─────────────────────────────

export function ConfidenceRing({
  pct,
  size = 30,
}: {
  readonly pct: number;
  readonly size?: number;
}) {
  const color = pct >= 80 ? T.green : pct >= 60 ? T.amber : T.gray;
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={T.surface3}
          strokeWidth="2.5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "8px",
          fontWeight: 700,
          color,
          fontFamily: T.mono,
        }}
      >
        {pct}
      </span>
    </div>
  );
}

// ── Urgency Meter (5 segments) ──────────────────────────────────────────

export function UrgencyMeter({ score }: { readonly score: number }) {
  const color = urgencyColor(score);
  return (
    <div style={{ display: "flex", gap: "3px", marginTop: "6px" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: "4px",
            borderRadius: "2px",
            backgroundColor: i <= score ? color : T.surface3,
            boxShadow: i <= score ? `0 0 6px ${color}55` : "none",
            transition: "background-color 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}
