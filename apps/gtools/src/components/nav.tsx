"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOLS } from "@/content/tools";
import { accentVar } from "@/components/browser-frame";
import { useMagnetic } from "@/components/fx/magnetic";
import { ToolLogo } from "@/components/tool-logo";

// Header logo-drop redesign (task 18) — replaces the "Tools" disclosure
// dropdown (task 17) with all 11 tools docked directly in the nav as
// compact logo-tile + lettering chips, miniature versions of the marquee
// items. Each chip (`data-fx="nav-chip"`, keyed by `data-fx-target`) is the
// permanent "home slot" scroll-fx-header-drop.ts scrubs its tool's logo out
// of and back into as that section passes — this component owns only the
// static chip row; all drop/ghost motion is applied imperatively by that
// registrar and is a no-op until the fine-pointer/no-reduced-motion gate
// passes, so server HTML and every non-motion visitor just see 11 plain
// anchor chips at full opacity.
//
// `overflow-x-auto` (not a breakpoint cutoff) is what keeps this from ever
// overflowing the page horizontally: 11 tiles comfortably fit unscrolled
// from `lg` up, and even at full lettering the row can occasionally need a
// few px more than an `xl` viewport offers — rather than hand-tuning exact
// breakpoint math (fragile against font metrics/zoom), the row just scrolls
// internally in that case. Lettering itself is `hidden` below `xl` per
// spec ("letters may hide below xl leaving tiles"); tiles remain reachable
// and named at every width via `aria-label` + native `title` tooltip.
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
      <div className="fx-nav-row mx-auto flex h-16 max-w-7xl items-center gap-3 px-6">
        <Link
          href="/"
          data-egg-trigger
          className="shrink-0 font-display text-lg font-semibold tracking-tight text-snow"
        >
          <span className="text-brand">G</span>TOOLS
        </Link>

        <nav
          aria-label="Tools"
          className="fx-nav-chips flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {TOOLS.map((tool) => (
            <a
              key={tool.slug}
              href={`#${tool.slug}`}
              data-fx="nav-chip"
              data-fx-target={tool.slug}
              aria-label={tool.name}
              title={tool.name}
              className="fx-nav-chip flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1"
            >
              <ToolLogo slug={tool.slug} size={16} />
              <span
                aria-hidden
                className="fx-nav-chip-label hidden font-display text-[11px] font-semibold tracking-tight xl:inline"
                style={{ color: accentVar(tool.accent) }}
              >
                {tool.name}
              </span>
            </a>
          ))}
        </nav>

        <a
          ref={contactRef}
          href="mailto:help@gamma.tech"
          className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Contact us
        </a>
      </div>
    </header>
  );
}
