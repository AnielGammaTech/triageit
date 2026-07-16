"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { PhoneCall, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import type { AppRole } from "@/lib/auth/page-role";

const NAV_ITEMS = [
  { href: "/command", label: "Command" },
  { href: "/dispatch", label: "Dispatch", icon: Radio },
  { href: "/tickets", label: "Tickets" },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/sla-hunter", label: "SLA Hunter" },
  { href: "/michael", label: "Prison Mike", avatar: "/prison-mike.png" },
  { href: "/toby", label: "Toby", avatar: "/toby.png" },
] as const;

const PRIMARY_COLOR = "#A61B1B";
const HEADER_BG = "#1a0a0a";
const DROPDOWN_BG = "#241010";

interface SidebarProps {
  readonly userEmail: string;
  readonly userRole: AppRole;
}

function getUserInitials(email: string): string {
  return email.charAt(0).toUpperCase();
}

export function Sidebar({ userEmail, userRole }: SidebarProps) {
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

  // Lock body scroll while the mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header
        className="triageit-frosted-nav fixed top-0 left-0 right-0 z-40 h-14 text-white"
      >
        <div className="mx-auto flex h-full max-w-full items-center justify-between px-4 sm:px-6">
          {/* Left: Logo + hamburger */}
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="lg:hidden -m-1.5 rounded-md p-3 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
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

            <Link href="/tickets" className="flex h-14 items-center gap-[9px]" aria-label="TriageIT home">
              <Image src="/triageit-mark.svg?v=20260716" alt="" width={44} height={44} className="h-11 w-11" />
              <span className="triageit-wordmark hidden whitespace-nowrap text-[22px] font-bold leading-none text-white sm:block">
                Triage<span className="text-[#E05555]">IT</span>
              </span>
            </Link>
          </div>

          {/* Center: Navigation (desktop) */}
          <nav className="hidden items-center h-full lg:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const className = cn(
                "relative flex items-center gap-2 px-4 h-14 text-sm font-medium transition-colors",
                isActive
                  ? "text-white"
                  : "text-white/60 hover:text-white hover:bg-white/5",
              );

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={className}
                >
                  {"avatar" in item && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.avatar}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover ring-1 ring-white/20"
                    />
                  )}
                  {"icon" in item && <item.icon className="h-4 w-4" />}
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

          {/* Right: Small profile avatar */}
          <div className="flex items-center gap-2" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="group -m-1.5 flex items-center rounded-full p-1.5"
              aria-label="Open profile menu"
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white transition-shadow group-hover:ring-2 group-hover:ring-white/20"
                style={{ backgroundColor: PRIMARY_COLOR }}
              >
                {getUserInitials(userEmail)}
              </div>
            </button>

            {dropdownOpen && (
              <div
                className="absolute right-4 top-12 w-60 animate-in rounded-lg border border-white/10 shadow-xl"
                style={{ backgroundColor: DROPDOWN_BG }}
              >
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
                        {userRole}
                      </span>
                    </div>
                  </div>
                </div>
                {userRole === "admin" && <div className="p-1">
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
                </div>}
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
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav
            className="absolute top-14 left-0 right-0 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-white/10 shadow-xl"
            style={{ backgroundColor: HEADER_BG }}
          >
            <div className="flex flex-col py-2">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const className = cn(
                  "flex items-center px-6 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "text-white bg-white/[0.08]"
                    : "text-white/60 hover:text-white hover:bg-white/5",
                );
                const style = isActive ? { borderLeft: `3px solid ${PRIMARY_COLOR}` } : { borderLeft: "3px solid transparent" };

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={className}
                    style={style}
                  >
                    {"avatar" in item && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.avatar}
                        alt=""
                        className="mr-2 h-5 w-5 rounded-full object-cover ring-1 ring-white/20"
                      />
                    )}
                    {"icon" in item && <item.icon className="mr-2 h-4 w-4" />}
                    {item.label}
                  </Link>
                );
              })}
              {userRole === "admin" && <Link
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
              </Link>}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
