import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requestHasAdminSession } from "@/lib/admin-auth";
import { safeUploadPath } from "@/lib/sop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

export async function POST(request: Request) {
  if (!requestHasAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }

  const destination = await safeUploadPath(file.name);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destination, bytes);

  return NextResponse.json({
    filename: path.basename(destination),
    url: `/uploads/${path.basename(destination)}`,
  });
}
