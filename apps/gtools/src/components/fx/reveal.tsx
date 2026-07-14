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
  /**
   * Optional external ref merged alongside Reveal's own internal one — lets
   * a caller (e.g. the magnetic-pull hook) get a handle on the exact same
   * DOM node Reveal is animating, without either wrapper clobbering the
   * other's ref.
   */
  innerRef?: React.Ref<HTMLElement>;
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
 * fx.css — so even a stray class name can never hide content for a
 * reduced-motion user.
 *
 * `will-change` is only cheap while an element is actually animating, so
 * fx.css scopes it to the "hidden"/"visible" states. Once the reveal
 * transition finishes (`transitionend`, with a timeout fallback in case that
 * event never fires — e.g. the element was already off-screen and the
 * property never actually changed value), this component advances to a
 * final "done" state that carries no `will-change` and no transition side
 * effects, so long-lived revealed content doesn't keep a permanent
 * compositor hint.
 */
export function Reveal({
  children,
  variant = "up",
  delayMs = 0,
  threshold = 0.2,
  innerRef,
}: RevealProps) {
  const ref = useRef<Element | null>(null);
  const [state, setState] = useState<"idle" | "hidden" | "visible" | "done">(
    "idle",
  );

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

  useEffect(() => {
    if (state !== "visible") return;
    // Cast to HTMLElement: every call site passes a plain DOM element (a,
    // div, li, section), and `transitionend` only lives on HTMLElementEventMap
    // — the base `Element` type this ref is declared with doesn't carry it.
    const node = ref.current as HTMLElement | null;
    if (!node) return;

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setState("done");
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== node) return;
      settle();
    };

    node.addEventListener("transitionend", handleTransitionEnd);
    // Fallback: if the transition never fires an end event (property didn't
    // actually change, reduced-motion toggled mid-flight, etc.) still drop
    // will-change after a bound comfortably longer than the 0.7s transition
    // plus the largest stagger delay in use on this site.
    const timeout = window.setTimeout(settle, 1500);

    return () => {
      node.removeEventListener("transitionend", handleTransitionEnd);
      window.clearTimeout(timeout);
    };
  }, [state]);

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

  // Merges Reveal's own ref with an optional caller-supplied `innerRef` so
  // two independent wrappers (this + e.g. the magnetic-pull hook) can both
  // get a handle on the same underlying node instead of one clobbering the
  // other's `ref` prop.
  const setRefs = (node: Element | null) => {
    ref.current = node;
    if (!innerRef) return;
    if (typeof innerRef === "function") innerRef(node as HTMLElement | null);
    else (innerRef as React.MutableRefObject<HTMLElement | null>).current = node as HTMLElement | null;
  };

  // `cloneElement`'s generics can't express "arbitrary host element accepting
  // a ref + data attribute" for a polymorphic single-child prop — every call
  // site here passes a plain DOM element (a, div, li, section), which all
  // accept refs natively, so the cast is safe in practice. The ref is only
  // ever attached (never read) here, so `react-hooks/refs`'s "may read
  // during render" warning is a false positive for this exact pattern.
  /* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs */
  return cloneElement(children, {
    ref: setRefs,
    className,
    style,
    "data-reveal-state": state === "idle" ? undefined : state,
  } as any);
  /* eslint-enable @typescript-eslint/no-explicit-any, react-hooks/refs */
}
