import type { HTMLAttributes } from "react";
import { tintVar } from "@/components/browser-frame";

// HTMLAttributes<HTMLSpanElement> alone doesn't include arbitrary
// `data-*` keys, so a literal like `{ "data-fx": "decrypt-kicker" }`
// fails the object-literal check even though React/JSX happily accepts
// any `data-*` attribute once spread onto a real element.
type SpanProps = HTMLAttributes<HTMLSpanElement> &
  Record<`data-${string}`, string | undefined>;

// Two-tone wordmark treatment (docs/brand/gtools-logo-standard.md,
// "Wordmark rule"): a tool's display name splits into "<Name>" + "IT",
// both in Manrope ExtraBold (`--font-wordmark`), where "<Name>" keeps
// whatever foreground color the caller sets on this component and "IT"
// is always the tool's wordmark TINT (`var(--color-<slug>-tint)`) — a
// brightened sibling of the locked logo hex, not the locked hex itself.
// Several locked hexes (ProjectIT, PortalIT, SecureIT, PhoneIT, TriageIT)
// are near-black/near-invisible as small text color directly on the
// site's #08080d ground; the tint keeps the same hue but is legible.
//
// Case-insensitive on the trailing "it" so it copes with the mixed
// casing already in content/tools-data-*.ts (e.g. "TriageIt" vs
// "SecureIT") — the rendered suffix is always canonical uppercase "IT"
// regardless of source casing.
function splitWordmark(name: string): { base: string; suffix: string } {
  if (name.length > 2 && /it$/i.test(name)) {
    return { base: name.slice(0, -2), suffix: "IT" };
  }
  return { base: name, suffix: "" };
}

export function ToolWordmark({
  name,
  slug,
  className = "",
  nameProps,
  decorative = false,
}: {
  name: string;
  slug: string;
  className?: string;
  // Lets a caller attach extra attributes (e.g. tool-section's
  // `data-fx="decrypt-kicker"` scramble hook) to just the base-name span,
  // so effects that rewrite an element's `textContent` (scroll-fx-decrypt.ts)
  // never land on the wrapper and clobber the accent-colored "IT" sibling.
  nameProps?: SpanProps;
  // Set when this wordmark duplicates a label that's already accessible
  // nearby (e.g. nav.tsx's chip, whose parent <a> already carries
  // aria-label/title) — hides the whole wordmark from the a11y tree instead
  // of exposing the tool name twice.
  decorative?: boolean;
}) {
  const { base, suffix } = splitWordmark(name);

  return (
    <span
      className={className}
      style={{ fontFamily: "var(--font-wordmark)" }}
      aria-hidden={decorative || undefined}
    >
      <span {...nameProps}>{base}</span>
      {suffix ? <span style={{ color: tintVar(slug) }}>{suffix}</span> : null}
    </span>
  );
}
