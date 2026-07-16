// Real per-tool logos (public/logos/<slug>.svg). Rendered as plain <img> —
// same static-export-friendly convention BrowserFrame uses for screenshots.
// Always decorative: alt="" + aria-hidden, since every call site places the
// logo directly beside the tool's name in text.
//
// Every mark in public/logos ships the same self-contained tile (colored
// rounded-square background + white letter/glyph + accent dot — see
// accountit.svg for the reference shape), including secureit.svg's
// dark-ink placeholder, so all eleven render identically here. No
// per-slug special case needed.
export function ToolLogo({
  slug,
  size,
  className = "",
}: {
  slug: string;
  size: number;
  className?: string;
}) {
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
