"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { T } from "./theme";

/**
 * Per-viewer section visibility for the embed triage panel.
 *
 * The page is server-rendered; these wrappers hydrate on the client, read
 * the viewer's saved preferences from localStorage, and show/hide sections.
 * The gear menu edits the prefs and broadcasts a window event so every
 * wrapper updates instantly. Defaults chosen by the user 2026-07-08:
 * stat band, duplicates, and the triage timeline/notes are ON; agent
 * findings and the pipeline are OFF (still one gear-click away).
 */

const STORAGE_KEY = "triageit.embed.sections.v1";
const CHANGE_EVENT = "tg-sections-changed";

export const SECTION_DEFS: ReadonlyArray<{ key: string; label: string; defaultVisible: boolean }> = [
  { key: "stats", label: "Stat band (priority / urgency / class / team)", defaultVisible: true },
  { key: "duplicates", label: "Possible duplicates", defaultVisible: true },
  { key: "findings", label: "Agent findings", defaultVisible: false },
  { key: "timeline", label: "Activity timeline (triage notes)", defaultVisible: true },
  { key: "reasoning", label: "Urgency reasoning", defaultVisible: true },
  { key: "notes", label: "Internal notes", defaultVisible: true },
  { key: "pipeline", label: "Agent pipeline (debug)", defaultVisible: false },
];

type Prefs = Record<string, boolean>;

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Prefs) : {};
    const merged: Prefs = {};
    for (const def of SECTION_DEFS) {
      merged[def.key] = typeof saved[def.key] === "boolean" ? saved[def.key] : def.defaultVisible;
    }
    return merged;
  } catch {
    return Object.fromEntries(SECTION_DEFS.map((d) => [d.key, d.defaultVisible]));
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private-browsing / storage-denied — toggles still work for this view
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(() =>
    Object.fromEntries(SECTION_DEFS.map((d) => [d.key, d.defaultVisible])),
  );

  useEffect(() => {
    const sync = () => setPrefs(loadPrefs());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return prefs;
}

/** Wrap a server-rendered section; hides it when the viewer toggled it off. */
export function ToggleableSection({
  sectionKey,
  children,
}: {
  readonly sectionKey: string;
  readonly children: React.ReactNode;
}) {
  const prefs = usePrefs();
  if (prefs[sectionKey] === false) return null;
  return <>{children}</>;
}

/** Gear menu — lives in the header, lists every section with a checkbox. */
export function SectionSettings() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const toggle = useCallback(
    (key: string) => {
      savePrefs({ ...loadPrefs(), [key]: !prefs[key] });
    },
    [prefs],
  );

  const hiddenCount = SECTION_DEFS.filter((d) => prefs[d.key] === false).length;

  return (
    <div ref={wrapRef} style={{ position: "relative", zIndex: 60 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Choose which sections to show"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          background: open ? T.surface2 : "transparent",
          border: `1px solid ${open ? T.line : "transparent"}`,
          borderRadius: "6px",
          padding: "3px 7px",
          cursor: "pointer",
          color: T.textMute,
          fontSize: "10px",
          fontFamily: T.mono,
          letterSpacing: "0.08em",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        VIEW
        {hiddenCount > 0 && <span style={{ color: T.textFaint }}>·{hiddenCount} hidden</span>}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: "250px",
            background: T.surface1,
            border: `1px solid ${T.line}`,
            borderRadius: "8px",
            padding: "8px",
            boxShadow: "0 12px 32px -8px rgba(0,0,0,0.7)",
          }}
        >
          <div
            style={{
              fontSize: "9px",
              fontFamily: T.mono,
              letterSpacing: "0.12em",
              color: T.textFaint,
              padding: "2px 6px 7px",
              textTransform: "uppercase",
            }}
          >
            Sections on this panel
          </div>
          {SECTION_DEFS.map((def) => {
            const on = prefs[def.key] !== false;
            return (
              <button
                key={def.key}
                type="button"
                onClick={() => toggle(def.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px",
                  cursor: "pointer",
                  color: on ? T.text : T.textFaint,
                  fontSize: "11.5px",
                  textAlign: "left" as const,
                }}
              >
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "4px",
                    border: `1px solid ${on ? T.brand : T.line}`,
                    background: on ? T.brand : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {on && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                {def.label}
              </button>
            );
          })}
          <div style={{ fontSize: "9.5px", color: T.textFaint, padding: "6px 6px 2px" }}>
            Saved in this browser only.
          </div>
        </div>
      )}
    </div>
  );
}
