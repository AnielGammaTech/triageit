"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import type { KbIdeaEntry } from "./page";

// ── Constants ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { readonly bg: string; readonly text: string }> = {
  article: { bg: "bg-blue-500/10", text: "text-blue-400" },
  procedure: { bg: "bg-violet-500/10", text: "text-violet-400" },
  vendor: { bg: "bg-amber-500/10", text: "text-amber-400" },
  asset: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  password_note: { bg: "bg-rose-500/10", text: "text-rose-400" },
  network: { bg: "bg-cyan-500/10", text: "text-cyan-400" },
  environment: { bg: "bg-orange-500/10", text: "text-orange-400" },
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-zinc-500",
};

const CONTENT_PREVIEW_LENGTH = 180;

// ── Helpers ──────────────────────────────────────────────────────────

function getCategoryStyle(category: string) {
  return CATEGORY_COLORS[category] ?? { bg: "bg-zinc-500/10", text: "text-zinc-400" };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

// ── Components ───────────────────────────────────────────────────────

function CategoryBadge({ category }: { readonly category: string }) {
  const style = getCategoryStyle(category);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", style.bg, style.text)}>
      {category.replace("_", " ")}
    </span>
  );
}

function ConfidenceDot({ confidence }: { readonly confidence: string }) {
  const color = CONFIDENCE_COLORS[confidence] ?? "text-zinc-500";
  return (
    <span className={cn("text-xs font-medium", color)}>
      {confidence}
    </span>
  );
}

function NeedsInfoIndicator({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
      {count} question{count !== 1 ? "s" : ""} needed
    </span>
  );
}

function KbIdeaCard({
  idea,
  isExpanded,
  onToggle,
}: {
  readonly idea: KbIdeaEntry;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 p-5 transition-all",
        "hover:border-white/15 hover:bg-white/[0.06] cursor-pointer",
      )}
      onClick={onToggle}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200 leading-snug flex-1 min-w-0">
          {idea.title}
        </h3>
        <CategoryBadge category={idea.category} />
      </div>

      {/* Meta row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>{idea.clientName}</span>
        <span>Ticket #{idea.ticketHaloId}</span>
        <span>{formatDate(idea.triageDate)}</span>
        <ConfidenceDot confidence={idea.confidence} />
        <NeedsInfoIndicator count={idea.needs_info.length} />
      </div>

      {/* Content preview or full */}
      {isExpanded ? (
        <div className="mt-4 space-y-3">
          {idea.why && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Why</p>
              <p className="text-sm text-zinc-300">{idea.why}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Content</p>
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {idea.content}
            </div>
          </div>
          {idea.hudu_section && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Hudu Section</p>
              <p className="text-sm text-zinc-400">{idea.hudu_section}</p>
            </div>
          )}
          {idea.needs_info.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">Needs Info</p>
              <ul className="list-disc list-inside space-y-1">
                {idea.needs_info.map((q, i) => (
                  <li key={i} className="text-sm text-amber-400/80">{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="pt-1">
            <p className="text-xs text-zinc-600">
              Source: {idea.ticketSummary}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
          {truncate(idea.content, CONTENT_PREVIEW_LENGTH)}
        </p>
      )}
    </div>
  );
}

// ── Main Browser ─────────────────────────────────────────────────────

export function KbIdeasBrowser({
  ideas,
}: {
  readonly ideas: ReadonlyArray<KbIdeaEntry>;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Derive unique categories and clients
  const categories = useMemo(() => {
    const set = new Set(ideas.map((i) => i.category));
    return [...set].sort();
  }, [ideas]);

  const clients = useMemo(() => {
    const set = new Set(ideas.map((i) => i.clientName));
    return [...set].sort();
  }, [ideas]);

  // Filter ideas (immutable)
  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return ideas.filter((idea) => {
      if (categoryFilter !== "all" && idea.category !== categoryFilter) return false;
      if (clientFilter !== "all" && idea.clientName !== clientFilter) return false;
      if (lowerSearch) {
        const haystack = `${idea.title} ${idea.category} ${idea.clientName} ${idea.content} ${idea.ticketSummary}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      return true;
    });
  }, [ideas, search, categoryFilter, clientFilter]);

  // Build a unique key for each idea for expansion tracking
  const getIdeaKey = (idea: KbIdeaEntry, index: number) =>
    `${idea.ticketHaloId}-${idea.title}-${index}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">KB Ideas</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Knowledge base article ideas generated from triage -- last 90 days
          </p>
        </div>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2">
          <span className="text-xs text-zinc-500">Total ideas</span>
          <span className="ml-2 text-lg font-bold text-indigo-400">{filtered.length}</span>
          {filtered.length !== ideas.length && (
            <span className="ml-1 text-xs text-zinc-600">/ {ideas.length}</span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by title, category, client, content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
          />
        </div>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-300 outline-none transition-colors focus:border-indigo-500/50 [&>option]:bg-zinc-900 [&>option]:text-zinc-200"
        >
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat.replace("_", " ")}
            </option>
          ))}
        </select>

        {/* Client filter */}
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-300 outline-none transition-colors focus:border-indigo-500/50 [&>option]:bg-zinc-900 [&>option]:text-zinc-200"
        >
          <option value="all">All clients</option>
          {clients.map((client) => (
            <option key={client} value={client}>
              {client}
            </option>
          ))}
        </select>
      </div>

      {/* Category summary pills */}
      {ideas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const count = ideas.filter((i) => i.category === cat).length;
            const style = getCategoryStyle(cat);
            const isActive = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(isActive ? "all" : cat)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? `${style.bg} ${style.text} border-current`
                    : "border-white/5 bg-white/[0.02] text-zinc-500 hover:border-white/10 hover:text-zinc-400",
                )}
              >
                {cat.replace("_", " ")}
                <span className={cn("font-semibold", isActive ? style.text : "text-zinc-400")}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Ideas grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-12 text-center">
          <p className="text-zinc-500">
            {ideas.length === 0
              ? "No KB ideas found. Ideas are generated during ticket triage when documentation gaps are detected."
              : "No ideas match your filters. Try adjusting the search or filters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((idea, index) => {
            const key = getIdeaKey(idea, index);
            return (
              <KbIdeaCard
                key={key}
                idea={idea}
                isExpanded={expandedId === key}
                onToggle={() => setExpandedId(expandedId === key ? null : key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
