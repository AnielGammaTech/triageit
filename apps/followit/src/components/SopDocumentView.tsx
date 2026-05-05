"use client";

import Link from "next/link";
import { categorySlug } from "@/lib/categories";
import { formatDisplayDate } from "@/lib/format";
import type { SopRecord } from "@/lib/types";
import { CopyLinkButton } from "./CopyLinkButton";
import { GammaLogo } from "./GammaLogo";

interface SopDocumentViewProps {
  readonly sop: SopRecord;
  readonly chrome?: "full" | "embed" | "preview";
}

export function SopDocumentView({ sop, chrome = "full" }: SopDocumentViewProps) {
  const showNav = chrome === "full";

  return (
    <article className={`sop-document sop-document-${chrome}`}>
      {showNav && (
        <div className="sop-actions no-print">
          <Link className="button button-muted" href="/">
            <span aria-hidden="true">Back</span>
            SOP index
          </Link>
          <CopyLinkButton />
          <button className="button button-muted" type="button" onClick={() => window.print()}>
            <span aria-hidden="true">PDF</span>
            Print
          </button>
        </div>
      )}

      <header className="sop-header">
        <div className="sop-header-inner">
          <GammaLogo />
          <div>
            <p className="sop-kicker">Standard Operating Procedure</p>
            <h1>{sop.title}</h1>
          </div>
        </div>
      </header>

      <section className="metadata-strip" aria-label="SOP metadata">
        <div>
          <span>Category</span>
          {showNav ? (
            <Link href={`/category/${categorySlug(sop.category)}`}>{sop.category}</Link>
          ) : (
            <strong>{sop.category}</strong>
          )}
        </div>
        <div>
          <span>Status</span>
          <strong className={`status-pill status-${sop.status.toLowerCase().replace(/\s+/g, "-")}`}>
            {sop.status}
          </strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{sop.version}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{sop.owner}</strong>
        </div>
        <div>
          <span>Approver</span>
          <strong>{sop.approver}</strong>
        </div>
        <div>
          <span>Effective</span>
          <strong>{formatDisplayDate(sop.effective_date)}</strong>
        </div>
        <div>
          <span>Last reviewed</span>
          <strong>{formatDisplayDate(sop.last_reviewed)}</strong>
        </div>
        <div>
          <span>Next review</span>
          <strong>{formatDisplayDate(sop.next_review)}</strong>
        </div>
        <div>
          <span>Classification</span>
          <strong>{sop.classification}</strong>
        </div>
      </section>

      <div className="sop-body" dangerouslySetInnerHTML={{ __html: sop.content_html }} />

      {showNav && (
        <aside className="hudu-panel no-print">
          <div>
            <h2>Hudu link target</h2>
            <p>Use this stable URL from Hudu KB articles. If the slug is renamed later, FollowIT keeps an automatic redirect.</p>
          </div>
          <a className="button button-muted" href={`/sop/${sop.slug}/embed`} target="_blank" rel="noreferrer">
            <span aria-hidden="true">Open</span>
            Embed view
          </a>
        </aside>
      )}

      <footer className="sop-footer">
        <span>Gamma Tech Services LLC</span>
        <span>FollowIT SOP Library</span>
      </footer>
    </article>
  );
}
