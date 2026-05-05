"use client";

import { useMemo, useState } from "react";
import { SOP_CATEGORIES } from "@/lib/categories";
import { slugify } from "@/lib/slug";
import { SOP_STATUSES, type SopRecord, type SopStatus } from "@/lib/types";
import { GammaLogo } from "./GammaLogo";
import { RichHtmlEditor } from "./RichHtmlEditor";
import { SopDocumentView } from "./SopDocumentView";

interface AdminWorkspaceProps {
  readonly initialSops: readonly SopRecord[];
}

type EditableSop = Omit<SopRecord, "tags"> & { tags: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankSop(): EditableSop {
  const currentDate = today();
  return {
    slug: "",
    title: "",
    category: SOP_CATEGORIES[0],
    owner: "Service Desk",
    approver: "Operations",
    status: "Draft",
    version: "1.0",
    effective_date: currentDate,
    last_reviewed: currentDate,
    next_review: currentDate,
    classification: "Internal",
    content_html: "<section><h2>1. Purpose</h2><p></p></section>",
    tags: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "followit-admin",
    updated_by: "followit-admin",
    screenshots: [],
  };
}

function toEditable(sop: SopRecord): EditableSop {
  return {
    ...sop,
    tags: sop.tags.join(", "),
  };
}

function toRecord(sop: EditableSop): SopRecord {
  const normalizedSlug = sop.slug.trim() || slugify(sop.title);
  return {
    ...sop,
    slug: normalizedSlug,
    tags: sop.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export function AdminWorkspace({ initialSops }: AdminWorkspaceProps) {
  const [sops, setSops] = useState<readonly SopRecord[]>(initialSops);
  const [selectedSlug, setSelectedSlug] = useState(initialSops[0]?.slug ?? "");
  const [draft, setDraft] = useState<EditableSop>(initialSops[0] ? toEditable(initialSops[0]) : blankSop());
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selected = useMemo(() => sops.find((sop) => sop.slug === selectedSlug), [selectedSlug, sops]);
  const previewRecord = toRecord(draft);

  function chooseSop(sop: SopRecord) {
    setSelectedSlug(sop.slug);
    setDraft(toEditable(sop));
    setPreview(false);
    setMessage("");
  }

  function update<K extends keyof EditableSop>(key: K, value: EditableSop[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/admin/uploads", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Upload failed");
    const data = (await response.json()) as { url: string };
    return data.url;
  }

  async function saveSop() {
    setSaving(true);
    setMessage("");
    const record = toRecord(draft);
    const originalSlug = selected?.slug;
    const endpoint = originalSlug ? `/api/admin/sops/${originalSlug}` : "/api/admin/sops";
    const response = await fetch(endpoint, {
      method: originalSlug ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    setSaving(false);
    if (!response.ok) {
      setMessage("Save failed. Check the required fields and try again.");
      return;
    }
    const data = (await response.json()) as { sop: SopRecord; sops: readonly SopRecord[] };
    setSops(data.sops);
    setSelectedSlug(data.sop.slug);
    setDraft(toEditable(data.sop));
    setMessage("Saved.");
  }

  async function deleteSelected() {
    if (!selected) return;
    const response = await fetch(`/api/admin/sops/${selected.slug}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Delete failed.");
      return;
    }
    const data = (await response.json()) as { sops: readonly SopRecord[] };
    setSops(data.sops);
    const next = data.sops[0];
    setSelectedSlug(next?.slug ?? "");
    setDraft(next ? toEditable(next) : blankSop());
    setMessage("Deleted.");
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = toEditable({
      ...selected,
      slug: `${selected.slug}-copy`,
      title: `${selected.title} Copy`,
      status: "Draft",
    });
    setSelectedSlug("");
    setDraft(copy);
    setPreview(false);
    setMessage("Editing duplicate draft.");
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    const response = await fetch("/api/admin/import", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      setMessage("Import failed.");
      return;
    }
    const data = (await response.json()) as { sops: readonly SopRecord[]; imported: readonly SopRecord[] };
    setSops(data.sops);
    if (data.imported[0]) {
      setSelectedSlug(data.imported[0].slug);
      setDraft(toEditable(data.imported[0]));
    }
    setMessage(`Imported ${data.imported.length} SOP file${data.imported.length === 1 ? "" : "s"}.`);
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div>
          <GammaLogo />
          <p>FollowIT Admin</p>
        </div>
        <a className="button button-muted" href="/">
          View library
        </a>
      </header>

      <main className="admin-grid">
        <aside className="admin-list">
          <div className="admin-list-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setSelectedSlug("");
                setDraft(blankSop());
                setPreview(false);
              }}
            >
              <span aria-hidden="true">+</span>
              New
            </button>
            <label className="button button-muted file-button">
              <span aria-hidden="true">HTML</span>
              Import
              <input hidden type="file" accept=".html,.htm,text/html" multiple onChange={(event) => importFiles(event.target.files)} />
            </label>
          </div>

          <div className="admin-sop-list">
            {sops.map((sop) => (
              <button
                className={sop.slug === selectedSlug ? "is-active" : ""}
                key={sop.slug}
                type="button"
                onClick={() => chooseSop(sop)}
              >
                <strong>{sop.title}</strong>
                <span>{sop.category}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-editor">
          <div className="editor-header">
            <div>
              <h1>{selected ? "Edit SOP" : "Create SOP"}</h1>
              {message && <p>{message}</p>}
            </div>
            <div className="editor-actions">
              <button className="button button-muted" type="button" onClick={() => setPreview((value) => !value)}>
                <span aria-hidden="true">View</span>
                Preview
              </button>
              <button className="button button-muted" type="button" onClick={duplicateSelected} disabled={!selected}>
                <span aria-hidden="true">Copy</span>
                Duplicate
              </button>
              <button className="button button-muted danger" type="button" onClick={deleteSelected} disabled={!selected}>
                <span aria-hidden="true">Del</span>
                Delete
              </button>
              <button className="button button-primary" type="button" onClick={saveSop} disabled={saving || !draft.title.trim()}>
              <span aria-hidden="true">OK</span>
                {saving ? "Saving" : draft.status === "Approved" ? "Publish" : "Save draft"}
              </button>
            </div>
          </div>

          {preview ? (
            <div className="preview-pane">
              <SopDocumentView sop={previewRecord} chrome="preview" />
            </div>
          ) : (
            <form className="sop-form" onSubmit={(event) => event.preventDefault()}>
              <label>
                Title
                <input value={draft.title} onChange={(event) => update("title", event.target.value)} />
              </label>
              <label>
                Slug
                <input value={draft.slug} onChange={(event) => update("slug", event.target.value)} placeholder="auto-generated-from-title" />
              </label>
              <label>
                Category
                <select value={draft.category} onChange={(event) => update("category", event.target.value)}>
                  {SOP_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={draft.status} onChange={(event) => update("status", event.target.value as SopStatus)}>
                  {SOP_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Owner
                <input value={draft.owner} onChange={(event) => update("owner", event.target.value)} />
              </label>
              <label>
                Approver
                <input value={draft.approver} onChange={(event) => update("approver", event.target.value)} />
              </label>
              <label>
                Version
                <input value={draft.version} onChange={(event) => update("version", event.target.value)} />
              </label>
              <label>
                Classification
                <input value={draft.classification} onChange={(event) => update("classification", event.target.value)} />
              </label>
              <label>
                Effective date
                <input type="date" value={draft.effective_date} onChange={(event) => update("effective_date", event.target.value)} />
              </label>
              <label>
                Last reviewed
                <input type="date" value={draft.last_reviewed} onChange={(event) => update("last_reviewed", event.target.value)} />
              </label>
              <label>
                Next review
                <input type="date" value={draft.next_review} onChange={(event) => update("next_review", event.target.value)} />
              </label>
              <label>
                Tags
                <input value={draft.tags} onChange={(event) => update("tags", event.target.value)} placeholder="halo, dispatch, onboarding" />
              </label>
              <div className="editor-field">
                <span>Body content</span>
                <RichHtmlEditor value={draft.content_html} onChange={(value) => update("content_html", value)} onUpload={uploadImage} />
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
