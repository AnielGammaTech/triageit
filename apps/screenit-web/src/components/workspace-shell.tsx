"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, FileCheck2, LayoutDashboard, LogOut, Radio, Settings, Users } from "lucide-react";
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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[linear-gradient(115deg,rgba(16,36,31,.98),rgba(18,49,42,.96))] shadow-[0_12px_32px_-22px_rgba(4,20,17,.9)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1380px] items-center gap-7 px-5 lg:px-8">
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
                  className={`relative flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium transition ${
                    active
                      ? "border border-white/10 bg-white/10 text-white shadow-inner shadow-white/[0.03]"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-teal-300" : "text-slate-400"}`} />
                  {item.label}
                  {active && <span className="absolute inset-x-3 -bottom-[15px] h-0.5 rounded-full bg-teal-300 shadow-[0_0_12px_rgba(94,234,212,.65)]" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-slate-300 sm:flex">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-50" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" /></span>
              Interview operations
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-teal-200/20 bg-gradient-to-br from-teal-300/25 to-white/10 text-xs font-bold text-white shadow-inner shadow-white/10">AR</div>
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
          <span className="mr-1 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-200/70"><Radio className="h-3 w-3" />ScreenIT</span>{items.map((item) => {
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
      <main className="mx-auto w-full max-w-[1380px] px-5 py-7 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
