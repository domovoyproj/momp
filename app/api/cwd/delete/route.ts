import { NextRequest, NextResponse } from "next/server";
import { existsSync, rmSync, statSync, unlinkSync } from "fs";
import { homedir } from "os";
import { normalize, resolve } from "path";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getRpcSession } from "@/lib/rpc-manager";
import { listAllSessions, invalidateSessionListCache, invalidateSessionPathCache } from "@/lib/session-reader";

function isProtectedRoot(dirPath: string): boolean {
  const norm = normalize(resolve(dirPath)).toLowerCase();
  const home = normalize(resolve(homedir())).toLowerCase();

  // Root drive checks
  if (/^[a-z]:\\?$/i.test(norm) || norm === "/" || norm === "\\") return true;
  // Home directory itself
  if (norm === home) return true;
  // Windows/System directories
  if (norm.startsWith("c:\\windows") || norm.startsWith("c:\\program files") || norm.startsWith("c:\\program files (x86)")) return true;
  if (norm === "/etc" || norm === "/usr" || norm === "/bin" || norm === "/sbin" || norm === "/var") return true;

  return false;
}

// POST /api/cwd/delete — Permanently delete a project directory from disk
export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const body = await request.json() as { path?: unknown };
    const targetPath = typeof body.path === "string" ? body.path.trim() : "";

    if (!targetPath) {
      return NextResponse.json({ error: "Directory path is required" }, { status: 400 });
    }

    const resolved = resolve(targetPath);
    if (!existsSync(resolved)) {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    if (isProtectedRoot(resolved)) {
      return NextResponse.json({ error: "Cannot delete protected system or home directory" }, { status: 403 });
    }

    const normTarget = normalize(resolved).toLowerCase();

    const allSessions = await listAllSessions({ force: true });
    const projectSessions = allSessions.filter((session) => {
      const sessionCwd = session.cwd ? normalize(resolve(session.cwd)).toLowerCase() : "";
      const projectRoot = session.projectRoot ? normalize(resolve(session.projectRoot)).toLowerCase() : "";
      return sessionCwd === normTarget || projectRoot === normTarget;
    });
    for (const session of projectSessions) {
      await getRpcSession(session.id)?.shutdown();
    }

    rmSync(resolved, { recursive: true, force: true });

    for (const session of projectSessions) {
      if (session.path && existsSync(session.path)) {
        unlinkSync(session.path);
      }
      invalidateSessionPathCache(session.id);
    }
    invalidateSessionListCache();

    return NextResponse.json({ ok: true, deletedPath: resolved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
