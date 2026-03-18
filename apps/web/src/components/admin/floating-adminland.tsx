"use client";

import Link from "next/link";

export function FloatingAdminland() {
  return (
    <Link
      href="/adminland"
      className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#6366f1] text-white shadow-lg shadow-[#6366f1]/25 transition-transform hover:scale-105 active:scale-95"
      title="Adminland"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      </svg>
    </Link>
  );
}
