"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accentVar } from "@/components/browser-frame";
import { TOOLS } from "@/content/tools";

const TRIGGER_WORD = "bears";
const CLICK_TRIGGER_COUNT = 3;
const CLICK_RESET_MS = 900;
const EFFECT_DURATION_MS = 5000;
const QUOTE_INTERVAL_MS = 1400;
const CONFETTI_COUNT = 48;

const QUOTES = [
  "I DECLARE… UPTIME!",
  "Bears. Beets. Battlestar Backups.",
  "You miss 100% of the tickets you don't triage.",
  "Identity theft is not a joke, Jim. Millions of tenants suffer every year.",
  "Would I rather be feared or loved? Easy. Both. I want techs afraid of how much they love this dashboard.",
  "That's the dream: work smart, not hard. Also, close more tickets.",
];

const CONFETTI_COLORS = TOOLS.map((tool) => accentVar(tool.accent));

// Hidden Office-flavored celebration: 3 clicks on the GTOOLS wordmark, or
// typing "bears" anywhere, fires a ~5s confetti burst (WAAPI-animated,
// transform/opacity only, cancelled + replayed from a fixed recycled node
// pool so nothing is ever created/destroyed mid-page-life) plus a centered
// aria-live toast that cycles a quote every ~1.4s, then everything reverts.
// Reduced motion skips the confetti entirely — the toast (a state change,
// not a loop) still appears, just without the fade/slide transition.
export function EasterEgg() {
  const [firing, setFiring] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const confettiRef = useRef<Array<HTMLSpanElement | null>>([]);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<number | null>(null);
  const keyBufferRef = useRef("");
  const revertTimerRef = useRef<number | null>(null);
  const quoteTimerRef = useRef<number | null>(null);

  const spawnConfetti = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const node of confettiRef.current) {
      if (!node) continue;
      node.getAnimations().forEach((anim) => anim.cancel());
      const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      node.style.background = color;
      const angle = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 260;
      const rotate = (Math.random() - 0.5) * 720;
      node.animate(
        [
          { transform: "translate3d(0, 0, 0) rotate(0deg)", opacity: 1, offset: 0 },
          {
            transform: `translate3d(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 40}px, 0) rotate(${rotate / 2}deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate3d(${Math.cos(angle) * dist * 1.3}px, ${Math.sin(angle) * dist * 1.3 + 220}px, 0) rotate(${rotate}deg)`,
            opacity: 0,
            offset: 1,
          },
        ],
        {
          duration: 1600 + Math.random() * 600,
          delay: Math.random() * 120,
          easing: "cubic-bezier(0.15, 0.6, 0.35, 1)",
          fill: "forwards",
        },
      );
    }
  }, []);

  const fire = useCallback(() => {
    setFiring(true);
    setQuoteIndex(0);
    spawnConfetti();

    let idx = 0;
    if (quoteTimerRef.current) window.clearInterval(quoteTimerRef.current);
    quoteTimerRef.current = window.setInterval(() => {
      idx = (idx + 1) % QUOTES.length;
      setQuoteIndex(idx);
    }, QUOTE_INTERVAL_MS);

    if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
    revertTimerRef.current = window.setTimeout(() => {
      setFiring(false);
      if (quoteTimerRef.current) {
        window.clearInterval(quoteTimerRef.current);
        quoteTimerRef.current = null;
      }
    }, EFFECT_DURATION_MS);
  }, [spawnConfetti]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-egg-trigger]")) return;

      clickCountRef.current += 1;
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickCountRef.current = 0;
      }, CLICK_RESET_MS);

      if (clickCountRef.current >= CLICK_TRIGGER_COUNT) {
        clickCountRef.current = 0;
        fire();
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      // Never hijack modifier combos (shortcuts, browser commands) or typing
      // inside a real input — this listener only ever *observes*, never
      // calls preventDefault/stopPropagation.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;

      keyBufferRef.current = (keyBufferRef.current + event.key.toLowerCase()).slice(
        -TRIGGER_WORD.length,
      );
      if (keyBufferRef.current === TRIGGER_WORD) {
        keyBufferRef.current = "";
        fire();
      }
    };

    document.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      document.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeydown);
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
      if (quoteTimerRef.current) window.clearInterval(quoteTimerRef.current);
    };
  }, [fire]);

  return (
    <>
      <div
        aria-hidden
        className="fx-egg-confetti pointer-events-none fixed inset-0 z-[998] overflow-hidden"
      >
        {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
          <span
            key={i}
            ref={(node) => {
              confettiRef.current[i] = node;
            }}
            className="fx-egg-piece"
          />
        ))}
      </div>

      <div
        className="fx-egg-toast pointer-events-none fixed inset-0 z-[999] flex items-center justify-center px-6"
        data-active={firing ? "true" : undefined}
      >
        <p role="status" aria-live="polite" className="fx-egg-toast-card">
          {firing ? QUOTES[quoteIndex] : ""}
        </p>
      </div>
    </>
  );
}
