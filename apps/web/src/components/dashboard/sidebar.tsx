"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/tickets", label: "Tickets", icon: "📋" },
  { href: "/agents", label: "Agents", icon: "🤖" },
  { href: "/integrations", label: "Integrations", icon: "🔌" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
] as const;

interface SidebarProps {
  readonly userEmail: string;
}

export function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-60 flex-col border-r border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] p-4">
        <h1 className="text-lg font-bold">TriageIt</h1>
        <p className="text-xs text-[var(--muted-foreground)]">
          Dunder Mifflin Triage
        </p>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith(item.href)
                ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-[var(--border)] p-4">
        <p className="mb-2 truncate text-xs text-[var(--muted-foreground)]">
          {userEmail}
        </p>
        <button
          onClick={handleSignOut}
          className="w-full rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
