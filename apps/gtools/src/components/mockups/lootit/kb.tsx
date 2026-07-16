const ARTICLES = [
  { title: "How force-match works", category: "Reconciliation" },
  { title: "Reading the sign-off packet", category: "Workflow" },
  { title: "Uploading an MSSP contract for auto-pricing", category: "Setup" },
  { title: "Anomaly alert thresholds explained", category: "Alerts" },
] as const;

/** "KB" nav view — help articles for the reconciliation workflow. */
export function KbView() {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Knowledge Base</span>
        <span className="text-[6.5px]" style={{ color: "var(--mock-muted)" }}>4 articles</span>
      </div>
      <div className="rounded-md border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {ARTICLES.map((a, i) => (
          <div
            key={a.title}
            className={`flex items-center gap-2 px-1.5 py-1.5 text-[7px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate">{a.title}</span>
            <span
              className="shrink-0 rounded-full px-1 py-0.5 text-[6px] font-medium"
              style={{ background: "var(--mock-panel-2)", color: "#EC4899" }}
            >
              {a.category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
