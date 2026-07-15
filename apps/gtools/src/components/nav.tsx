"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { useMagnetic } from "@/components/fx/magnetic";
import { ToolLogo } from "@/components/tool-logo";

const CLOSE_DELAY_MS = 150;

// Nav redesign (task 17) — the 11 text links cramped the bar, so they're
// replaced by a single "Tools" disclosure: hover-intent on desktop (with a
// short close delay so moving the cursor from trigger to panel doesn't
// flicker), click/tap to open for touch and keyboard, Escape + click-outside
// to close. The trigger's `onClick` only ever *opens* (never toggles closed)
// — a real mouse click always hovers the element first, so a toggle would
// immediately flip an already hover-opened panel straight back shut on
// every click; closing is handled uniformly by mouseleave (desktop),
// Escape (keyboard), or clicking anywhere else (touch, since there's no
// hover-leave to rely on there). Deliberately not `role="menu"`/`menuitem`
// — that ARIA pattern implies roving-tabindex arrow-key navigation this
// component doesn't implement; it's a plain disclosure over a `<nav>` of
// ordinary links, which is both simpler and more correct here. The scroll
// listener for `data-scrolled` (glow/tighten effect in fx-diagram.css) is
// unchanged from before this redesign.
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const contactRef = useMagnetic<HTMLAnchorElement>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setToolsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsOpen]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  function openTools() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setToolsOpen(true);
  }
  function scheduleCloseTools() {
    closeTimer.current = setTimeout(() => setToolsOpen(false), CLOSE_DELAY_MS);
  }

  return (
    <header
      className="fx-nav sticky top-0 z-50 border-b border-line/70 bg-ink/75 backdrop-blur-md"
      data-scrolled={scrolled ? "true" : undefined}
    >
      <div className="fx-nav-row mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          data-egg-trigger
          className="font-display text-lg font-semibold tracking-tight text-snow"
        >
          <span className="text-brand">G</span>TOOLS
        </Link>

        <div
          ref={wrapRef}
          className="relative hidden xl:block"
          onMouseEnter={openTools}
          onMouseLeave={scheduleCloseTools}
        >
          <button
            type="button"
            data-fx="nav-tools-trigger"
            aria-haspopup="true"
            aria-expanded={toolsOpen}
            aria-controls="fx-tools-panel"
            onClick={openTools}
            className="fx-tools-trigger flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors"
          >
            Tools
            <svg
              aria-hidden
              viewBox="0 0 12 8"
              className={`size-2.5 shrink-0 transition-transform duration-200 ${
                toolsOpen ? "-rotate-180" : ""
              }`}
            >
              <path
                d="M1 1.5 6 6.5 11 1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {toolsOpen && (
            <nav
              id="fx-tools-panel"
              aria-label="Tools"
              className="fx-tools-panel absolute top-full left-1/2 z-50 mt-2 w-[420px] -translate-x-1/2 rounded-2xl border border-line bg-panel/95 p-3 shadow-2xl backdrop-blur-xl"
            >
              <div className="grid grid-cols-2 gap-1">
                {TOOLS.map((tool) => (
                  <a
                    key={tool.slug}
                    href={`#${tool.slug}`}
                    data-fx="nav-link"
                    data-fx-target={tool.slug}
                    style={{ "--nav-accent": accentVar(tool.accent) } as React.CSSProperties}
                    onClick={() => setToolsOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fog transition-colors hover:bg-panel-2 hover:text-snow"
                  >
                    <ToolLogo slug={tool.slug} size={18} />
                    {tool.name}
                  </a>
                ))}
              </div>
            </nav>
          )}
        </div>

        <a
          ref={contactRef}
          href="mailto:help@gamma.tech"
          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Contact us
        </a>
      </div>
    </header>
  );
}
