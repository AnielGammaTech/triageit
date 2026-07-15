"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOLS } from "@/content/tools";
import { useMagnetic } from "@/components/fx/magnetic";

// The only bit of Nav that needs the client: a tiny scroll listener that
// flips `data-scrolled` for the glow/tighten effect in globals.css
// (`.fx-nav[data-scrolled="true"]`). CSS scroll-driven animations
// (`animation-timeline: scroll()`) would be the "purer" CSS-only route, but
// their support is still inconsistent enough across Chrome/Safari/Firefox
// for a `position: sticky` header that a silent no-op in one browser felt
// worse than this ~10-line, universally-reliable listener.
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
      <div className="fx-nav-row mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          data-egg-trigger
          className="font-display text-lg font-semibold tracking-tight text-snow"
        >
          <span className="text-brand">G</span>TOOLS
        </Link>

        <nav className="hidden items-center gap-4 xl:flex" aria-label="Tools">
          {TOOLS.map((tool) => (
            <a
              key={tool.slug}
              href={`#${tool.slug}`}
              className="whitespace-nowrap text-sm text-fog transition-colors hover:text-snow"
            >
              {tool.name}
            </a>
          ))}
        </nav>

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
