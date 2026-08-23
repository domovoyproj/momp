#!/usr/bin/env bun
// Builds the tauri-updater `latest.json` for a GitHub release after the
// desktop build matrix has uploaded its artifacts, then uploads it with
// `--clobber`. A separate finalize step is required because tauri-action's
// own `includeUpdaterJson` is per-job: with a build matrix every job would
// upload its own single-platform latest.json and the last one would win,
// silently breaking updates for the other platforms.
//
// Usage: bun scripts/build-updater-json.mjs <tag> [--dry-run]
//
// Needs: gh CLI authenticated (GITHUB_TOKEN), and TAURI_SIGNING_PRIVATE_KEY +
// TAURI_SIGNING_PRIVATE_KEY_PASSWORD for signing each artifact (Ed25519,
// deterministic: re-signing a downloaded artifact yields the same signature
// tauri-action computed at build time).
//
// Platform mapping: the universal macOS dmg serves both darwin-aarch64 and
// darwin-x86_64 (the updater matches `{os}-{arch}` platform keys, and both
// keys pointing at one universal asset is the documented shape).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [tag, ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
if (!tag) {
  console.error("usage: bun scripts/build-updater-json.mjs <tag> [--dry-run]");
  process.exit(2);
}

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    console.error(`command failed: ${cmd} ${args.join(" ")}\n${res.stderr ?? res.stdout ?? ""}`);
    process.exit(1);
  }
  return res.stdout.trim();
};

const release = JSON.parse(run("gh", ["release", "view", tag, "--json", "assets,published_at,name"]));
const version = tag.replace(/^v/, "");
const assets = release.assets.filter((a) => !a.name.endsWith(".sig"));

// One platform key per updater target. The same universal .app.tar.gz is
// served to both macOS architectures; the NSIS setup exe serves Windows.
const platformFor = (asset) => {
  if (asset.name.endsWith(".app.tar.gz")) return ["darwin-aarch64", "darwin-x86_64"];
  if (asset.name.endsWith(".exe") && /setup/i.test(asset.name)) return ["windows-x86_64"];
  return [];
};

const candidates = assets.flatMap((a) => platformFor(a).map((p) => [p, a]));
if (candidates.length === 0) {
  console.error(`no updater artifacts (.app.tar.gz / *-setup.exe) found in release ${tag}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "omp-updater-"));
const platforms = {};
try {
  for (const [key, asset] of candidates) {
    const local = join(tmp, asset.name);
    run("curl", ["-fsSL", "-o", local, asset.browser_download_url]);
    // tauri signer sign prints the base64 Ed25519 signature; keep only the
    // base64 line (the CLI may prefix it with explanatory output).
    const out = run("bun", ["run", "tauri", "signer", "sign", "-f", local], {
      env: { ...process.env },
    });
    const signature = out
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
    if (!signature) {
      console.error(`could not parse signature from signer output for ${asset.name}:\n${out}`);
      process.exit(1);
    }
    platforms[key] = { url: asset.browser_download_url, signature };
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const latest = {
  version,
  notes: release.name,
  pub_date: release.published_at,
  platforms,
};

if (dryRun) {
  console.log(JSON.stringify(latest, null, 2));
  process.exit(0);
}

writeFileSync("latest.json", JSON.stringify(latest));
run("gh", ["release", "upload", tag, "latest.json", "--clobber"]);
console.log(`uploaded latest.json for ${tag} (${Object.keys(platforms).length} platform entries)`);
