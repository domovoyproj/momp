import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function buildAntigravityFixture(directory) {
  const windows = process.platform === "win32";
  const executable = join(directory, windows ? "agy-fixture.exe" : "agy-fixture");
  const script = fileURLToPath(new URL("./antigravity-acp.mjs", import.meta.url));
  // Bun 1.4.4's self-copy on Windows fails under a Unicode profile path.
  const runtime = [];
  if (windows && /[^\x00-\x7f]/.test(process.execPath)) {
    const copy = join(directory, "fixture-bun.exe");
    copyFileSync(process.execPath, copy);
    runtime.push(`--compile-executable-path=${copy}`);
  }
  execFileSync(process.execPath, ["build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", ...runtime, script, "--outfile", executable],
    { timeout: 60_000, windowsHide: true });
  return executable;
}
