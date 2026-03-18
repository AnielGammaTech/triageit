"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { CustomerDetail } from "@/components/customers/customer-detail";

// ── Types ─────────────────────────────────────────────────────────────

interface HaloCustomer {
  readonly id: number;
  readonly name: string;
  readonly is_active: boolean;
  readonly main_site: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly ticket_count: number;
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");

  const [customers, setCustomers] = useState<ReadonlyArray<HaloCustomer>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [triageCounts, setTriageCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    loadCustomers();
    loadTriageCounts();
  }, []);

  async function loadCustomers() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/halo/customers");
      const data = (await response.json()) as {
        customers?: ReadonlyArray<HaloCustomer>;
        error?: string;
      };

      if (data.error) {
        setError(data.error);
      } else {
        setCustomers(data.customers ?? []);
      }
    } catch {
      setError("Failed to fetch customers");
    }
    setLoading(false);
  }

  async function loadTriageCounts() {
    const supabase = createClient();
    const { data } = await supabase
      .from("tickets")
      .select("client_name, status");

    if (data) {
      const counts: Record<string, number> = {};
      for (const row of data) {
        const name = (row.client_name as string) ?? "";
        if (name) {
          counts[name] = (counts[name] ?? 0) + 1;
        }
      }
      setTriageCounts(counts);
    }
  }

  const filtered = search.trim()
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()),
      )
    : customers;

  // ── Customer Detail View ────────────────────────────────────────────

  if (selectedId) {
    const customer = customers.find((c) => c.id === Number(selectedId));

    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-white/50">
          <button
            onClick={() => router.push("/customers")}
            className="transition-colors hover:text-white"
          >
            Customers
          </button>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="font-medium text-white">
            {customer?.name ?? `Customer #${selectedId}`}
          </span>
        </div>
        <CustomerDetail
          customerId={Number(selectedId)}
          customerName={customer?.name ?? null}
          customerEmail={customer?.email ?? null}
          customerPhone={customer?.phone ?? null}
          customerSite={customer?.main_site ?? null}
        />
      </div>
    );
  }

  // ── Customer List View ──────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-400" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 21a8 8 0 0 0-16 0" />
                <circle cx="10" cy="8" r="5" />
                <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Customers</h2>
              <p className="text-sm text-white/50">
                {loading
                  ? "Loading from Halo PSA..."
                  : `${customers.length} customers synced from Halo`}
              </p>
            </div>
          </div>
          <button
            onClick={loadCustomers}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={cn(loading && "animate-spin")}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-white/40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            Fetching customers from Halo PSA...
          </div>
        </div>
      )}

      {/* Customer list */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-12 text-center">
          <p className="text-sm text-white/50">
            {customers.length === 0
              ? "No customers found. Make sure Halo PSA is connected in Integrations."
              : "No customers match your search."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/40">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/40">
                  Site
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">
                  Halo Tickets
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">
                  Triaged
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => {
                const triageCount = triageCounts[customer.name] ?? 0;
                return (
                  <tr
                    key={customer.id}
                    onClick={() => router.push(`/customers?id=${customer.id}`)}
                    className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-xs font-bold text-blue-400">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-white">
                            {customer.name}
                          </p>
                          {customer.email && (
                            <p className="text-xs text-white/30">
                              {customer.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/50">
                      {customer.main_site ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/50">
                        {customer.ticket_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {triageCount > 0 ? (
                        <span className="rounded-full bg-[#6366f1]/10 px-2 py-0.5 text-xs font-medium text-[#6366f1]">
                          {triageCount}
                        </span>
                      ) : (
                        <span className="text-xs text-white/20">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          customer.is_active
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-white/5 text-white/30",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 rounded-full",
                            customer.is_active
                              ? "bg-emerald-400"
                              : "bg-white/30",
                          )}
                        />
                        {customer.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
