import Anthropic from "@anthropic-ai/sdk";
import type { TicketImageContext } from "../types.js";

// ── Vision Pre-Processor ──────────────────────────────────────────────
// Uses Haiku to describe ticket screenshots/images so specialist agents
// (who only see text) can understand visual content like error messages,
// NDR bounce-backs, diagnostic screenshots, etc.

export async function describeTicketImages(
  images: ReadonlyArray<TicketImageContext>,
  ticketSummary: string,
): Promise<string | null> {
  if (images.length === 0) return null;

  const client = new Anthropic();

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [
    {
      type: "text",
      text: `This ticket is about: "${ticketSummary}"\n\nDescribe each image below in detail. Extract ALL text, error messages, codes, domain names, email addresses, IP addresses, status indicators, and any other technical details visible. This information will be used by specialist agents to diagnose the issue.\n\nFor each image, format as:\n**Image: [filename]**\n[detailed description with all extracted text]\n`,
    },
  ];

  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64Data,
      },
    });
    content.push({
      type: "text",
      text: `Filename: ${img.filename}${img.who ? ` (uploaded by ${img.who})` : ""}`,
    });
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });

  const description =
    response.content[0].type === "text" ? response.content[0].text : null;

  return description;
}

// ── HTML Strip (for Halo action notes) ───────────────────────────────

export function stripHtmlActions(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
