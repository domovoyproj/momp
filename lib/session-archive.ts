import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@/lib/session-reader";

// Frontend-only session archive: a flat registry of session ids kept outside
// the session files themselves. Archiving never moves or edits a session, so
// the omp CLI and --resume are unaffected; restoring is a flag flip.
const REGISTRY_FILE = "omp-web-archived.json";

export function readArchivedIds(): Set<string> {
  try {
    const file = join(getAgentDir(), REGISTRY_FILE);
    if (!existsSync(file)) return new Set();
    const data = JSON.parse(readFileSync(file, "utf8")) as { archived?: unknown };
    if (!data || !Array.isArray(data.archived)) return new Set();
    return new Set(data.archived.filter((v): v is string => typeof v === "string"));
  } catch {
    // A corrupt registry must never break the session list; worst case the
    // archive marks are lost, the sessions themselves are untouched.
    return new Set();
  }
}

export function setSessionArchived(id: string, archived: boolean): void {
  const ids = readArchivedIds();
  if (archived) ids.add(id);
  else ids.delete(id);
  const file = join(getAgentDir(), REGISTRY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ archived: [...ids].sort() }, null, 2));
  renameSync(tmp, file);
}
