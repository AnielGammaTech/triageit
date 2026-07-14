import Link from "next/link";
import { TOOLS } from "@/content/tools";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-ink/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tight text-snow"
        >
          <span className="text-brand">G</span>TOOLS
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Tools">
          {TOOLS.map((tool) => (
            <a
              key={tool.slug}
              href={`#${tool.slug}`}
              className="text-sm text-fog transition-colors hover:text-snow"
            >
              {tool.name}
            </a>
          ))}
        </nav>

        <a
          href="mailto:help@gamma.tech"
          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Contact us
        </a>
      </div>
    </header>
  );
}
