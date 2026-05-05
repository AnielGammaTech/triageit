import { NextResponse } from "next/server";
import { requestHasAdminSession } from "@/lib/admin-auth";
import { parseSopHtml } from "@/lib/html-import";
import { listSops, upsertSop } from "@/lib/sop-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!requestHasAdminSession(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No HTML files provided" }, { status: 400 });
  }

  const imported = [];
  for (const file of files) {
    const html = await file.text();
    const sop = parseSopHtml(html, file.name);
    imported.push(await upsertSop(sop));
  }

  return NextResponse.json({ imported, sops: await listSops() });
}
