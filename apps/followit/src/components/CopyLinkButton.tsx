"use client";

import { useState } from "react";

interface CopyLinkButtonProps {
  readonly value?: string;
}

export function CopyLinkButton({ value }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const href = value ?? window.location.href;
    await navigator.clipboard.writeText(href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className="button button-primary" type="button" onClick={handleCopy}>
      <span aria-hidden="true">{copied ? "OK" : "Link"}</span>
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
