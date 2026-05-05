import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { uploadDir } from "@/lib/sop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UploadRouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: UploadRouteContext) {
  const { path: segments } = await params;
  const relative = path.normalize(segments.join("/"));
  if (relative.startsWith("..") || path.isAbsolute(relative)) notFound();

  const filePath = path.join(uploadDir(), relative);
  try {
    const file = await fs.readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    notFound();
  }
}
