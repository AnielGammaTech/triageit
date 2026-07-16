"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * Shared state + a11y helper for the shallow, one-level-deep interactive
 * navigation inside each tool's mockup (task: gtools interactive mockups).
 * Each mockup keeps its own bespoke header/nav markup (colors, layout, and
 * copy come straight from that app's real UI spec) — this file only
 * standardizes the parts that must behave identically everywhere: the
 * useState-backed active view, the real <button> tab control (cursor,
 * hover tint, aria-pressed, stopPropagation so clicks never bubble into
 * page scroll/nav), and the crossfade wrapper around the active view.
 */

/** Local view-switch state for one mockup. Starts on `initial` so the
 * server-rendered markup (and first client render, pre-hydration) always
 * matches the tool's current signature screen — no hydration mismatch. */
export function useMockupView<K extends string>(initial: K) {
  return useState<K>(initial);
}

export function MockupTabButton<K extends string>({
  view,
  label,
  active,
  onSelect,
  activeStyle,
  idleStyle,
  className = "",
}: {
  view: K;
  label: string;
  active: boolean;
  onSelect: (view: K) => void;
  activeStyle: CSSProperties;
  idleStyle: CSSProperties;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Show ${label} view`}
      onClick={(event) => {
        // Never let a tab click bubble into ancestor scroll/nav handlers —
        // this is a shallow, in-frame demo, not real navigation.
        event.stopPropagation();
        onSelect(view);
      }}
      className={`mockup-tab cursor-pointer appearance-none border-0 bg-transparent p-0 text-left leading-none ${className}`.trim()}
      style={active ? activeStyle : idleStyle}
    >
      {label}
    </button>
  );
}

/** Wraps the active view's content. Re-keyed on view change so the fast
 * opacity/transform crossfade (`.mockup-fade` in fx-mockup.css) replays;
 * the animation itself only exists under
 * `prefers-reduced-motion: no-preference`, so reduced-motion users get an
 * instant swap with no intermediate state. */
export function MockupViewport({
  view,
  children,
  className = "",
}: {
  view: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div key={view} className={`mockup-fade ${className}`.trim()}>
      {children}
    </div>
  );
}
