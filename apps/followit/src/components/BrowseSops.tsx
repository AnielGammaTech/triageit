"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { categorySlug, SOP_CATEGORIES } from "@/lib/categories";
import { formatDisplayDate, isDueForReview, stripHtml } from "@/lib/format";
import { SOP_STATUSES, type SopRecord, type SopStatus } from "@/lib/types";
import { GammaLogo } from "./GammaLogo";

type SortField = "title" | "category" | "last_reviewed" | "effective_date";

interface BrowseSopsProps {
  readonly sops: readonly SopRecord[];
  readonly initialCategory?: string;
}

function statusClass(status: SopStatus): string {
  return `status-pill status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

function searchText(sop: SopRecord): string {
  return `${sop.title} ${sop.category} ${sop.owner} ${sop.status} ${sop.tags.join(" ")} ${stripHtml(sop.content_html)}`.toLowerCase();
}

export function BrowseSops({ sops, initialCategory = "all" }: BrowseSopsProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SopStatus | "all">("all");
  const [category, setCategory] = useState(initialCategory);
  const [dueOnly, setDueOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>("title");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sops
      .filter((sop) => category === "all" || sop.category === category)
      .filter((sop) => status === "all" || sop.status === status)
      .filter((sop) => !dueOnly || isDueForReview(sop.next_review))
      .filter((sop) => !needle || searchText(sop).includes(needle))
      .sort((a, b) => {
        if (sortBy === "category") return a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
        if (sortBy === "last_reviewed") return b.last_reviewed.localeCompare(a.last_reviewed);
        if (sortBy === "effective_date") return b.effective_date.localeCompare(a.effective_date);
        return a.title.localeCompare(b.title);
      });
  }, [category, dueOnly, query, sops, sortBy, status]);

  const categoryCounts = useMemo(() => {
    return SOP_CATEGORIES.map((item) => ({
      category: item,
      count: sops.filter((sop) => sop.category === item).length,
    }));
  }, [sops]);

  return (
    <div className="app-frame">
      <header className="library-header">
        <div className="library-header-main">
          <GammaLogo />
          <div>
            <p className="sop-kicker">FollowIT</p>
            <h1>Standard Operating Procedures</h1>
          </div>
        </div>
        <Link className="button button-primary" href="/admin">
          Admin
        </Link>
      </header>

      <div className="browse-layout">
        <aside className={`category-sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <button className="mobile-filter-toggle" type="button" onClick={() => setSidebarOpen((open) => !open)}>
            <span aria-hidden="true">Filter</span>
            Categories
          </button>
          <div className="category-list">
            <button
              className={category === "all" ? "is-active" : ""}
              type="button"
              onClick={() => setCategory("all")}
            >
              <span>All SOPs</span>
              <strong>{sops.length}</strong>
            </button>
            {categoryCounts.map((item) => (
              <Link
                className={category === item.category ? "is-active" : ""}
                href={`/category/${categorySlug(item.category)}`}
                key={item.category}
                onClick={() => setCategory(item.category)}
              >
                <span>{item.category}</span>
                <strong>{item.count}</strong>
              </Link>
            ))}
          </div>
        </aside>

        <main className="browse-main">
          <section className="toolbar">
            <label className="search-box">
              <span aria-hidden="true">Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, content, or tags"
                type="search"
              />
            </label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortField)} aria-label="Sort SOPs">
              <option value="title">Sort by title</option>
              <option value="category">Sort by category</option>
              <option value="last_reviewed">Sort by last reviewed</option>
              <option value="effective_date">Sort by effective date</option>
            </select>
          </section>

          <section className="filter-row" aria-label="SOP filters">
            <button className={status === "all" ? "chip is-active" : "chip"} type="button" onClick={() => setStatus("all")}>
              All statuses
            </button>
            {SOP_STATUSES.map((item) => (
              <button
                className={status === item ? "chip is-active" : "chip"}
                key={item}
                type="button"
                onClick={() => setStatus(item)}
              >
                {item}
              </button>
            ))}
            <button className={dueOnly ? "chip is-active" : "chip"} type="button" onClick={() => setDueOnly((value) => !value)}>
              Due for review
            </button>
          </section>

          <section className="summary-strip" aria-label="SOP summary">
            <div>
              <strong>{filtered.length}</strong>
              <span>matching SOPs</span>
            </div>
            <div>
              <strong>{sops.filter((sop) => sop.status === "Approved").length}</strong>
              <span>approved</span>
            </div>
            <div>
              <strong>{sops.filter((sop) => isDueForReview(sop.next_review)).length}</strong>
              <span>due soon</span>
            </div>
          </section>

          <section className="sop-grid" aria-label="SOP list">
            {filtered.map((sop) => (
              <Link className="sop-card" href={`/sop/${sop.slug}`} key={sop.slug}>
                <div className="sop-card-top">
                  <span className="category-badge">{sop.category}</span>
                  <span className={statusClass(sop.status)}>{sop.status}</span>
                </div>
                <h2>{sop.title}</h2>
                <p>{stripHtml(sop.content_html).slice(0, 150)}...</p>
                <dl>
                  <div>
                    <dt>Owner</dt>
                    <dd>{sop.owner}</dd>
                  </div>
                  <div>
                    <dt>Last reviewed</dt>
                    <dd>{formatDisplayDate(sop.last_reviewed)}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}
