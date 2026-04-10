"use client";

import { useState, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────

interface KbIdea {
  readonly title: string;
  readonly category: string;
  readonly content: string;
  readonly hudu_section: string;
  readonly why: string;
  readonly needs_info: ReadonlyArray<string>;
  readonly confidence: "high" | "medium" | "low";
}

interface RefinedArticle {
  readonly title: string;
  readonly content: string;
  readonly hudu_section: string;
  readonly summary: string;
}

type Phase = "idle" | "generating" | "ideas" | "answering" | "refining" | "article";

// ── Styles ──────────────────────────────────────────────────────────────

const btn = (color: string, bg: string, border: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "6px 10px",
  fontSize: "10px",
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  color,
  backgroundColor: bg,
  border: `1px solid ${border}`,
  borderRadius: "4px",
  cursor: "pointer",
  transition: "all 0.15s ease",
  whiteSpace: "nowrap" as const,
  letterSpacing: "0.02em",
  lineHeight: 1,
});

const CONF_COLORS: Record<string, string> = {
  high: "#00b894",
  medium: "#fdcb6e",
  low: "#636e72",
};

const CAT_COLORS: Record<string, string> = {
  article: "#74b9ff",
  procedure: "#a29bfe",
  vendor: "#fd79a8",
  asset: "#00cec9",
  password_note: "#ff4757",
  network: "#0984e3",
  environment: "#00b894",
};

// ── Component ───────────────────────────────────────────────────────────

export function KBBuilder({
  haloId,
  token,
}: {
  readonly haloId: number;
  readonly token: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ideas, setIdeas] = useState<ReadonlyArray<KbIdea>>([]);
  const [globalQuestions, setGlobalQuestions] = useState<ReadonlyArray<string>>([]);
  const [selectedIdea, setSelectedIdea] = useState<KbIdea | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [article, setArticle] = useState<RefinedArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Generate ideas
  const handleGenerate = useCallback(async () => {
    if (phase === "generating") return;
    setPhase("generating");
    setError(null);

    try {
      const res = await fetch("/api/embed/kb-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId, token }),
      });

      if (!res.ok) {
        setError("Failed to generate ideas");
        setPhase("idle");
        return;
      }

      const data = (await res.json()) as {
        ideas: KbIdea[];
        questions: string[];
      };

      if (!data.ideas || data.ideas.length === 0) {
        setError("No KB ideas found for this ticket");
        setPhase("idle");
        return;
      }

      setIdeas(data.ideas);
      setGlobalQuestions(data.questions ?? []);
      setPhase("ideas");
    } catch {
      setError("Failed to reach worker");
      setPhase("idle");
    }
  }, [haloId, token, phase]);

  // ── Select idea and start answering
  const handleSelectIdea = useCallback((idea: KbIdea) => {
    setSelectedIdea(idea);
    const initial: Record<string, string> = {};
    for (const q of idea.needs_info) {
      initial[q] = "";
    }
    for (const q of globalQuestions) {
      initial[q] = "";
    }
    setAnswers(initial);
    setPhase("answering");
  }, [globalQuestions]);

  // ── Build article
  const handleBuildArticle = useCallback(async () => {
    if (!selectedIdea) return;
    setPhase("refining");
    setError(null);

    try {
      const res = await fetch("/api/embed/kb-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          halo_id: haloId,
          token,
          idea: selectedIdea,
          answers,
        }),
      });

      if (!res.ok) {
        setError("Failed to build article");
        setPhase("answering");
        return;
      }

      const data = (await res.json()) as { article: RefinedArticle };
      setArticle(data.article);
      setPhase("article");
    } catch {
      setError("Failed to reach worker");
      setPhase("answering");
    }
  }, [haloId, token, selectedIdea, answers]);

  // ── Copy article
  const handleCopy = useCallback(async () => {
    if (!article) return;
    try {
      await navigator.clipboard.writeText(article.content);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = article.content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [article]);

  // ── Reset
  const handleBack = useCallback(() => {
    if (phase === "article") {
      setArticle(null);
      setPhase("answering");
    } else if (phase === "answering") {
      setSelectedIdea(null);
      setAnswers({});
      setPhase("ideas");
    } else {
      setIdeas([]);
      setPhase("idle");
    }
    setError(null);
  }, [phase]);

  // ── IDLE: just the button
  if (phase === "idle") {
    return (
      <>
        <button
          onClick={handleGenerate}
          style={btn("#636e72", "#12131a", "#1e2028")}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2d3040"; e.currentTarget.style.color = "#8b8fa3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2028"; e.currentTarget.style.color = "#636e72"; }}
        >
          Gen KB
        </button>
        {error && <span style={{ fontSize: "9px", color: "#ff4757" }}>{error}</span>}
      </>
    );
  }

  // ── GENERATING: spinner button
  if (phase === "generating") {
    return (
      <button disabled style={{ ...btn("#74b9ff", "rgba(116,185,255,0.08)", "rgba(116,185,255,0.2)"), cursor: "not-allowed", opacity: 0.8 }}>
        <span style={{
          display: "inline-block", width: "10px", height: "10px",
          border: "1.5px solid rgba(116,185,255,0.3)", borderTopColor: "#74b9ff",
          borderRadius: "50%", animation: "spin 0.6s linear infinite",
        }} />
        Analyzing ticket...
      </button>
    );
  }

  // ── IDEAS: show cards
  if (phase === "ideas") {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={panelStyle}>
          <div style={panelHeader}>
            <span style={panelTitle}>KB IDEAS</span>
            <span style={{ fontSize: "9px", color: "#3d4051" }}>{ideas.length} ideas</span>
            <button onClick={handleBack} style={dismissBtn}>close</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column" as const, gap: "6px" }}>
            {ideas.map((idea, i) => (
              <div key={i} style={ideaCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <span style={{
                    fontSize: "8px", fontWeight: 800, color: CAT_COLORS[idea.category] ?? "#636e72",
                    backgroundColor: `${CAT_COLORS[idea.category] ?? "#636e72"}15`,
                    padding: "1px 5px", borderRadius: "2px", letterSpacing: "0.08em",
                    textTransform: "uppercase" as const,
                  }}>
                    {idea.category}
                  </span>
                  <span style={{
                    fontSize: "8px", fontWeight: 700, color: CONF_COLORS[idea.confidence],
                    letterSpacing: "0.06em", textTransform: "uppercase" as const,
                  }}>
                    {idea.confidence}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: "9px", color: "#3d4051" }}>{idea.hudu_section}</span>
                </div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#c8ccd4", marginBottom: "3px", fontFamily: "'Inter', system-ui, sans-serif" }}>
                  {idea.title}
                </div>
                <div style={{ fontSize: "10px", color: "#636e72", lineHeight: 1.5, marginBottom: "6px", fontFamily: "'Inter', system-ui, sans-serif" }}>
                  {idea.why}
                </div>
                {idea.needs_info.length > 0 && (
                  <div style={{ fontSize: "9px", color: "#fdcb6e", marginBottom: "6px" }}>
                    {idea.needs_info.length} question{idea.needs_info.length > 1 ? "s" : ""} for you
                  </div>
                )}
                <button
                  onClick={() => handleSelectIdea(idea)}
                  style={btn("#6c5ce7", "rgba(108,92,231,0.08)", "rgba(108,92,231,0.2)")}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(108,92,231,0.15)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "rgba(108,92,231,0.08)"; }}
                >
                  Build This Article
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── ANSWERING: show questions for the selected idea
  if (phase === "answering" && selectedIdea) {
    const questions = Object.keys(answers);
    const hasQuestions = questions.length > 0;

    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={panelStyle}>
          <div style={panelHeader}>
            <span style={panelTitle}>BUILD KB ARTICLE</span>
            <button onClick={handleBack} style={dismissBtn}>back</button>
          </div>

          <div style={{ fontSize: "11px", fontWeight: 700, color: "#c8ccd4", marginBottom: "6px", fontFamily: "'Inter', system-ui, sans-serif" }}>
            {selectedIdea.title}
          </div>

          {/* Draft preview */}
          <div style={{
            fontSize: "10px", color: "#636e72", lineHeight: 1.6, marginBottom: "10px",
            padding: "8px 10px", background: "#0c0d10", borderRadius: "4px", border: "1px solid #1e2028",
            maxHeight: "120px", overflow: "auto", fontFamily: "'Inter', system-ui, sans-serif",
            whiteSpace: "pre-wrap" as const,
          }}>
            {selectedIdea.content}
          </div>

          {/* Questions */}
          {hasQuestions && (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: "8px", marginBottom: "10px" }}>
              <div style={{ fontSize: "9px", fontWeight: 800, color: "#fdcb6e", letterSpacing: "0.1em" }}>
                DWIGHT NEEDS YOUR INPUT
              </div>
              {questions.map((q) => (
                <div key={q}>
                  <label style={{
                    display: "block", fontSize: "10px", color: "#8b8fa3", marginBottom: "3px",
                    lineHeight: 1.4, fontFamily: "'Inter', system-ui, sans-serif",
                  }}>
                    {q}
                  </label>
                  <input
                    type="text"
                    value={answers[q] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                    placeholder="Type answer or leave blank to skip"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: "10px",
                      fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                      color: "#c8ccd4",
                      backgroundColor: "#0c0d10",
                      border: "1px solid #1e2028",
                      borderRadius: "4px",
                      outline: "none",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#6c5ce7"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#1e2028"; }}
                  />
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ fontSize: "9px", color: "#ff4757", marginBottom: "6px" }}>{error}</div>}

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={handleBuildArticle}
              style={btn("#fff", "#6c5ce7", "#6c5ce7")}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              {hasQuestions ? "Build with Answers" : "Build Article"}
            </button>
            {hasQuestions && (
              <button
                onClick={() => { setAnswers({}); handleBuildArticle(); }}
                style={btn("#636e72", "#12131a", "#1e2028")}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#8b8fa3"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#636e72"; }}
              >
                Skip Questions
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── REFINING: spinner
  if (phase === "refining") {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={panelStyle}>
          <div style={panelHeader}>
            <span style={panelTitle}>BUILDING ARTICLE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 0" }}>
            <span style={{
              display: "inline-block", width: "14px", height: "14px",
              border: "2px solid rgba(108,92,231,0.3)", borderTopColor: "#6c5ce7",
              borderRadius: "50%", animation: "spin 0.6s linear infinite",
            }} />
            <span style={{ fontSize: "11px", color: "#8b8fa3", fontFamily: "'Inter', system-ui, sans-serif" }}>
              Dwight is writing the KB article...
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── ARTICLE: show the polished result
  if (phase === "article" && article) {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={panelStyle}>
          <div style={panelHeader}>
            <span style={panelTitle}>KB ARTICLE READY</span>
            <button onClick={handleBack} style={dismissBtn}>back</button>
          </div>

          <div style={{ fontSize: "11px", fontWeight: 700, color: "#00b894", marginBottom: "2px", fontFamily: "'Inter', system-ui, sans-serif" }}>
            {article.title}
          </div>
          <div style={{ fontSize: "9px", color: "#3d4051", marginBottom: "8px" }}>
            {article.hudu_section}
          </div>

          {/* Article content */}
          <div style={{
            fontSize: "11px", color: "#c8ccd4", lineHeight: 1.7,
            padding: "10px 12px", background: "#0c0d10", borderRadius: "4px", border: "1px solid #1e2028",
            maxHeight: "300px", overflow: "auto", fontFamily: "'Inter', system-ui, sans-serif",
            whiteSpace: "pre-wrap" as const,
          }}>
            {article.content}
          </div>

          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <button
              onClick={handleCopy}
              style={btn(
                copied ? "#00b894" : "#fff",
                copied ? "rgba(0,184,148,0.08)" : "#6c5ce7",
                copied ? "rgba(0,184,148,0.2)" : "#6c5ce7",
              )}
            >
              {copied ? "Copied!" : "Copy Article"}
            </button>
            <button
              onClick={() => { setPhase("idle"); setIdeas([]); setSelectedIdea(null); setArticle(null); }}
              style={btn("#636e72", "#12131a", "#1e2028")}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Shared panel styles ─────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#12131a",
  border: "1px solid #1e2028",
  borderLeft: "2px solid #6c5ce7",
  borderRadius: "4px",
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
};

const panelTitle: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 800,
  color: "#6c5ce7",
  letterSpacing: "0.1em",
  flex: 1,
};

const ideaCard: React.CSSProperties = {
  padding: "10px 12px",
  background: "#0c0d10",
  border: "1px solid #1e2028",
  borderRadius: "4px",
};

const dismissBtn: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: "9px",
  fontWeight: 600,
  color: "#636e72",
  backgroundColor: "transparent",
  border: "1px solid #1e2028",
  borderRadius: "3px",
  cursor: "pointer",
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
};
