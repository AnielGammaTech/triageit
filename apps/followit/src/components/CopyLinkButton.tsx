"use client";

import { useState } from "react";

interface CopyLinkButtonProps {
  readonly value?: string;
  readonly label?: string;
  readonly copiedLabel?: string;
  readonly icon?: string;
  readonly copiedIcon?: string;
  readonly className?: string;
  readonly format?: "url" | "iframe";
  readonly title?: string;
}

function absoluteUrl(value: string): string {
  return new URL(value, window.location.origin).toString();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function CopyLinkButton({
  value,
  label = "Copy link",
  copiedLabel = "Copied",
  icon = "Link",
  copiedIcon = "OK",
  className = "button button-primary",
  format = "url",
  title = "FollowIT SOP",
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const href = absoluteUrl(value ?? window.location.href);
    const copyValue =
      format === "iframe"
        ? `<iframe src="${escapeAttribute(href)}" title="${escapeAttribute(title)}" width="100%" height="900" style="border:0;max-width:100%;" loading="lazy"></iframe>`
        : href;
    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className={className} type="button" onClick={handleCopy}>
      <span aria-hidden="true">{copied ? copiedIcon : icon}</span>
      {copied ? copiedLabel : label}
    </button>
  );
}
