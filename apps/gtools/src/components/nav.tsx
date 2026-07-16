"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOLS } from "@/content/tools";
import { useMagnetic } from "@/components/fx/magnetic";
import { ToolLogo } from "@/components/tool-logo";
import { ToolWordmark } from "@/components/tool-wordmark";

// Header logo-drop redesign (task 18) — replaces the "Tools" disclosure
// dropdown (task 17) with all 11 tools docked directly in the nav as
// compact logo-tile + lettering chips. Each chip (`data-fx="nav-chip"`,
// keyed by `data-fx-target`) is the permanent "home slot"
// scroll-fx-header-drop.ts scrubs its tool's logo out of and back into as
// that section passes — this component owns only the static chip row; all
// drop/ghost motion is applied imperatively by that registrar and is a
// no-op until the fine-pointer/no-reduced-motion gate passes, so server
// HTML and every non-motion visitor just see 11 plain anchor chips at full
// opacity.
//
// Task 19 fix — the previous density (16px tiles, 11px labels, looser
// gaps/padding) needed more width than the row actually has at `xl`
// (1280px, the container's own `max-w-7xl` cap — 1440px/1920px viewports
// get the *same* available width, since the row never grows past that),
// so the last chip ("VendIT") silently overflowed into the hidden
// scrollbar and read as clipped. Every dimension below (tile size, label
// size/tracking, chip/row gaps) was tightened until 11 lettered chips plus
// the brand mark and Contact button measure comfortably under that cap —
// verified with real boundingBox measurements at 1280/1440/1920, not just
// eyeballed. `overflow-x-auto` stays on as a last-resort safety net (e.g.
// extreme browser zoom) but is no longer load-bearing for the normal
// breakpoints. Lettering is still `hidden` below `xl` ("letters hide below
// xl, leaving tiles"); tiles remain reachable and named at every width via
// `aria-label` + native `title` tooltip.
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const contactRef = useMagnetic<HTMLAnchorElement>();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fx-nav sticky top-0 z-50 border-b border-line/70 bg-ink/75 backdrop-blur-md"
      data-scrolled={scrolled ? "true" : undefined}
    >
      <div className="fx-nav-row mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 md:px-6">
        <Link
          href="/"
          data-egg-trigger
          className="shrink-0 font-display text-lg font-semibold tracking-tight text-snow"
        >
          <span className="text-brand">G</span>TOOLS
        </Link>

        <nav
          aria-label="Tools"
          className="fx-nav-chips flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {TOOLS.map((tool) => (
            <a
              key={tool.slug}
              href={`#${tool.slug}`}
              data-fx="nav-chip"
              data-fx-target={tool.slug}
              aria-label={tool.name}
              title={tool.name}
              className="fx-nav-chip flex shrink-0 items-center gap-1 rounded-full px-1 py-1"
            >
              <ToolLogo slug={tool.slug} size={14} />
              <ToolWordmark
                name={tool.name}
                slug={tool.slug}
                className="fx-nav-chip-label hidden text-[10px] font-semibold tracking-[-0.01em] text-snow xl:inline"
                decorative
              />
            </a>
          ))}
        </nav>

        <a
          ref={contactRef}
          href="https://gamma.tech"
          className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Contact us
        </a>
      </div>
    </header>
  );
}
