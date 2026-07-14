"use client";

import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

export type RevealVariant = "up" | "left" | "right" | "scale";

interface RevealChildProps {
  className?: string;
  style?: CSSProperties;
}

interface RevealProps {
  /**
   * Exactly one element. Reveal clones it in place instead of wrapping it in
   * a new DOM node, so grid/flex layouts, semantics, and existing styling on
   * the child are never disturbed (a hard requirement here: no layout shift).
   */
  children: ReactElement<RevealChildProps>;
  /** Direction the element travels in from while hidden. */
  variant?: RevealVariant;
  /** Stagger delay in ms, applied as the `--reveal-delay` CSS var. */
  delayMs?: number;
  /** IntersectionObserver threshold before the reveal fires. */
  threshold?: number;
}

const isBrowser = typeof window !== "undefined";

/**
 * Reveal-once scroll/entrance animation. Progressive enhancement is the
 * whole point: server-rendered markup has no hidden state at all, so with JS
 * disabled (or before hydration finishes) content is exactly as visible as
 * if Reveal didn't exist. Only once this component mounts on the client does
 * a `useLayoutEffect` (which runs before the browser paints) flip the child
 * into its pre-reveal "hidden" state; an IntersectionObserver then flips it
 * to "visible" the moment it scrolls into view, and never again.
 *
 * `prefers-reduced-motion: reduce` is honored twice over, belt and braces:
 * this component skips the hidden state outright when the media query
 * matches, AND every visual effect the `data-reveal-state` attribute drives
 * lives inside a `@media (prefers-reduced-motion: no-preference)` block in
 * globals.css — so even a stray class name can never hide content for a
 * reduced-motion user.
 */
export function Reveal({
  children,
  variant = "up",
  delayMs = 0,
  threshold = 0.2,
}: RevealProps) {
  const ref = useRef<Element | null>(null);
  const [state, setState] = useState<"idle" | "hidden" | "visible">("idle");

  useLayoutEffect(() => {
    if (!isBrowser) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setState("hidden");
  }, []);

  useEffect(() => {
    if (state !== "hidden") return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState("visible");
            observer.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [state, threshold]);

  const style: CSSProperties = {
    ...children.props.style,
    ...(delayMs ? ({ "--reveal-delay": `${delayMs}ms` } as CSSProperties) : {}),
  };

  const className = [
    children.props.className,
    "fx-reveal",
    `fx-reveal-${variant}`,
  ]
    .filter(Boolean)
    .join(" ");

  // `cloneElement`'s generics can't express "arbitrary host element accepting
  // a ref + data attribute" for a polymorphic single-child prop — every call
  // site here passes a plain DOM element (a, div, li, section), which all
  // accept refs natively, so the cast is safe in practice. The ref is only
  // ever attached (never read) here, so `react-hooks/refs`'s "may read
  // during render" warning is a false positive for this exact pattern.
  /* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs */
  return cloneElement(children, {
    ref,
    className,
    style,
    "data-reveal-state": state === "idle" ? undefined : state,
  } as any);
  /* eslint-enable @typescript-eslint/no-explicit-any, react-hooks/refs */
}
