import { NextRequest, NextResponse } from "next/server";
import { createDirectory } from "@/lib/directory-browser";

// POST /api/cwd/mkdir — create a new folder inside a browsable directory so a
// project can be started in a location that does not exist yet.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { parent?: unknown; name?: unknown };
    const parent = typeof body.parent === "string" ? body.parent.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!parent) return NextResponse.json({ error: "Parent directory is required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });

    const created = await createDirectory(parent, name);
    return NextResponse.json({ path: created });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
