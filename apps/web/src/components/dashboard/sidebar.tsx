"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/tickets", label: "Tickets" },
  { href: "/customers", label: "Customers" },
  { href: "/workers", label: "Workers" },
  { href: "/integrations", label: "Integrations" },
  { href: "/analytics", label: "Analytics" },
] as const;

const PRIMARY_COLOR = "#6366f1";

interface SidebarProps {
  readonly userEmail: string;
}

function getUserInitials(email: string): string {
  return email.charAt(0).toUpperCase();
}

export function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-40 h-14 text-white"
        style={{ backgroundColor: "#13082E" }}
      >
        <div className="mx-auto flex h-full max-w-full items-center justify-between px-4 sm:px-6">
          {/* Left: Logo + hamburger */}
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="lg:hidden rounded-md p-1.5 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Toggle menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {mobileMenuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>

            <Link href="/tickets" className="flex items-center gap-2.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: PRIMARY_COLOR }}
              >
                T
              </div>
              <span className="hidden text-sm font-bold tracking-tight text-white sm:block">
                TriageIt
              </span>
            </Link>
          </div>

          {/* Center: Navigation (desktop) */}
          <nav className="hidden items-center h-full lg:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2 px-4 h-14 text-sm font-medium transition-colors",
                    isActive
                      ? "text-white"
                      : "text-white/60 hover:text-white hover:bg-white/5",
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-0.5"
                      style={{ backgroundColor: PRIMARY_COLOR }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: User dropdown */}
          <div className="flex items-center gap-2" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2.5 rounded-lg py-1 pl-2 pr-1 transition-colors hover:bg-white/5"
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: PRIMARY_COLOR }}
              >
                {getUserInitials(userEmail)}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-medium leading-tight text-white">
                  {userEmail}
                </p>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="hidden text-white/40 sm:block"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-4 top-12 w-60 animate-in rounded-lg border border-white/10 bg-[#1a0f35] shadow-xl">
                <div className="border-b border-white/10 px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{ backgroundColor: PRIMARY_COLOR }}
                    >
                      {getUserInitials(userEmail)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {userEmail}
                      </p>
                      <span
                        className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        style={{
                          backgroundColor: `${PRIMARY_COLOR}20`,
                          color: PRIMARY_COLOR,
                        }}
                      >
                        Admin
                      </span>
                    </div>
                  </div>
                </div>
                <div className="p-1">
                  <Link
                    href="/adminland"
                    onClick={() => setDropdownOpen(false)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Adminland
                  </Link>
                </div>
                <div className="border-t border-white/10 p-1">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      handleSignOut();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 transition-colors hover:bg-white/5 hover:text-red-300"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" x2="9" y1="12" y2="12" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile navigation overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Menu panel */}
          <nav
            className="absolute top-14 left-0 right-0 border-b border-white/10 shadow-xl"
            style={{ backgroundColor: "#13082E" }}
          >
            <div className="flex flex-col py-2">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center px-6 py-3 text-sm font-medium transition-colors",
                      isActive
                        ? "text-white bg-white/[0.08]"
                        : "text-white/60 hover:text-white hover:bg-white/5",
                    )}
                    style={isActive ? { borderLeft: `3px solid ${PRIMARY_COLOR}` } : { borderLeft: "3px solid transparent" }}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/adminland"
                className={cn(
                  "flex items-center px-6 py-3 text-sm font-medium transition-colors border-t border-white/[0.06] mt-1",
                  pathname.startsWith("/adminland")
                    ? "text-white bg-white/[0.08]"
                    : "text-white/60 hover:text-white hover:bg-white/5",
                )}
                style={pathname.startsWith("/adminland") ? { borderLeft: `3px solid ${PRIMARY_COLOR}` } : { borderLeft: "3px solid transparent" }}
              >
                Adminland
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
