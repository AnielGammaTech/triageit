"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BriefcaseBusiness, FileCheck2, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { ScreenItLogo } from "@/components/screenit-logo";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/positions", label: "Positions", icon: BriefcaseBusiness },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/reports", label: "Reports", icon: FileCheck2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function WorkspaceShell({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-700/80 bg-[#172521]/95 shadow-[0_8px_24px_-18px_rgba(15,23,42,.9)] backdrop-blur-xl">
        <div className="mx-auto flex h-[66px] max-w-[1420px] items-center gap-8 px-5 lg:px-8">
          <Link href="/" aria-label="ScreenIT dashboard">
            <ScreenItLogo />
          </Link>
          <nav className="hidden h-full items-center gap-1 md:flex">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex h-10 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-teal-300" : "text-slate-400"}`} />
                  {item.label}
                  {active && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-teal-400" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300 sm:flex">
              <BarChart3 className="h-3.5 w-3.5 text-teal-300" />
              Structured review mode
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/10 text-xs font-bold text-white">AR</div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.06] px-3 py-2 md:hidden">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${active ? "bg-teal-500/15 text-teal-200" : "text-slate-400"}`}>
                <Icon className="h-3.5 w-3.5" />{item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1420px] px-5 py-7 lg:px-8 lg:py-9">{children}</main>
    </div>
  );
}
