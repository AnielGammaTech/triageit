// Real per-tool logos (public/logos/<slug>.svg). Rendered as plain <img> —
// same static-export-friendly convention BrowserFrame uses for screenshots.
// Always decorative: alt="" + aria-hidden, since every call site places the
// logo directly beside the tool's name in text.
//
// SecureIT's actual mark (public/logos/secureit.svg) is a monochrome-ink
// lucide glyph with no background fill — true to the product's real
// branding, but it disappears against this site's near-black surfaces. A
// small light chip behind just that one logo keeps it legible without
// inventing a fake brand color for the other ten, which already ship their
// own colored tile baked into the SVG.
export function ToolLogo({
  slug,
  size,
  className = "",
}: {
  slug: string;
  size: number;
  className?: string;
}) {
  if (slug === "secureit") {
    const padding = Math.round(size * 0.16);
    return (
      <span
        aria-hidden
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-snow/90 ${className}`}
        style={{ width: size, height: size, padding }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logos/secureit.svg"
          alt=""
          width={size}
          height={size}
          className="block h-full w-full"
        />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/logos/${slug}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
