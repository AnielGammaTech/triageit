"use client";

import { useEffect, useRef } from "react";

interface RichHtmlEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onUpload: (file: File) => Promise<string>;
}

function insertHtml(html: string) {
  document.execCommand("insertHTML", false, html);
}

export function RichHtmlEditor({ value, onChange, onUpload }: RichHtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  function sync() {
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function run(command: string, commandValue?: string) {
    document.execCommand(command, false, commandValue);
    editorRef.current?.focus();
    sync();
  }

  async function handleFileChange(file: File | undefined) {
    if (!file) return;
    const url = await onUpload(file);
    insertHtml(`<img src="${url}" alt="${file.name.replace(/"/g, "")}" />`);
    sync();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="rich-editor">
      <div className="editor-toolbar" aria-label="Editor tools">
        <button type="button" onClick={() => run("formatBlock", "h2")} title="Heading">
          H2
        </button>
        <button type="button" onClick={() => run("formatBlock", "p")} title="Paragraph">
          P
        </button>
        <button type="button" onClick={() => run("bold")} title="Bold">
          B
        </button>
        <button type="button" onClick={() => run("italic")} title="Italic">
          I
        </button>
        <button type="button" onClick={() => run("insertUnorderedList")} title="Bullet list">
          UL
        </button>
        <button type="button" onClick={() => run("insertOrderedList")} title="Numbered list">
          OL
        </button>
        <button type="button" onClick={() => run("formatBlock", "blockquote")} title="Block quote">
          Quote
        </button>
        <button
          type="button"
          onClick={() => {
            insertHtml("<pre><code>Paste command or code here</code></pre>");
            sync();
          }}
          title="Code block"
        >
          {"</>"}
        </button>
        <button
          type="button"
          onClick={() => {
            insertHtml(
              '<table><thead><tr><th>Column</th><th>Details</th></tr></thead><tbody><tr><td>Value</td><td>Description</td></tr></tbody></table>',
            );
            sync();
          }}
          title="Insert table"
        >
          Table
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} title="Upload image">
          Img
        </button>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="image/*"
          onChange={(event) => handleFileChange(event.target.files?.[0])}
        />
      </div>
      <div
        ref={editorRef}
        className="editor-surface sop-body"
        contentEditable
        role="textbox"
        aria-label="SOP body content"
        onInput={sync}
        suppressContentEditableWarning
      />
    </div>
  );
}
