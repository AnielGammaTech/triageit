interface GammaLogoProps {
  readonly compact?: boolean;
}

export function GammaLogo({ compact = false }: GammaLogoProps) {
  return (
    <div className="gamma-logo" aria-label="Gamma Tech">
      <svg className="gamma-mark" viewBox="0 0 64 64" role="img" aria-hidden="true">
        <circle cx="32" cy="32" r="25" fill="none" stroke="#c8d0d8" strokeWidth="7" />
        <path
          d="M50 21a23 23 0 0 0-18-10 21 21 0 1 0 18 32"
          fill="none"
          stroke="#017ED7"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path d="M32 31h20v7H38v11h-7V31z" fill="#017ED7" />
      </svg>
      {!compact && (
        <span className="gamma-wordmark">
          <span>GAMMA</span>
          <strong>TECH</strong>
        </span>
      )}
    </div>
  );
}
