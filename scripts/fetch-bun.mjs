#!/usr/bin/env bun
/**
 * fetch-bun.mjs — download pinned Bun binaries for the Tauri desktop bundle.
 *
 * Usage:
 *   bun scripts/fetch-bun.mjs [triple...]
 *
 *   triples: darwin-aarch64, darwin-x64, windows-x64 (default: all three)
 *   --force: re-download even when the target file already exists
 *
 * Environment:
 *   BUN_VERSION: override the pinned version (default: installed bun version,
 *   read from Bun.version, falling back to `bun --version`).
 *
 * The zip from GitHub contains `bun-{triple}/bun` (or `bun.exe` on Windows).
 * The binary is moved to `src-tauri/resources/bun-{triple}` (with `.exe`
 * suffix for Windows) and made executable on unix. Idempotent: existing
 * targets are skipped unless --force is passed.
 */

import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TRIPLES = ["darwin-aarch64", "darwin-x64", "windows-x64"];

const REPO_ROOT = join(import.meta.dir, "..");
const RESOURCES_DIR = join(REPO_ROOT, "src-tauri", "resources");

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.filter((a) => a !== "--force");
const triples = requested.length > 0 ? requested : TRIPLES;

for (const triple of triples) {
  if (!TRIPLES.includes(triple)) {
    console.error(`[fetch-bun] unknown triple "${triple}" (expected one of: ${TRIPLES.join(", ")})`);
    process.exit(1);
  }
}

/** Resolve the bun version to pin. */
function bunVersion() {
  if (process.env.BUN_VERSION) return process.env.BUN_VERSION;
  if (typeof Bun !== "undefined" && Bun.version) return Bun.version;
  const res = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`could not read bun version: ${res.stderr || "bun --version failed"}`);
  }
  return res.stdout.trim();
}

/** Download and install one triple. Returns { target, skipped }. */
async function fetchTriple(triple, version) {
  const isWindows = triple === "windows-x64";
  const targetName = `bun-${triple}${isWindows ? ".exe" : ""}`;
  const target = join(RESOURCES_DIR, targetName);

  if (existsSync(target) && !force) {
    console.log(`[fetch-bun] ${targetName} already exists — skipping (use --force to re-download)`);
    return { target, skipped: true };
  }

  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${triple}.zip`;
  console.log(`[fetch-bun] downloading ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText} (${url})`);
  }

  const zipPath = join(tmpdir(), `bun-${triple}-${version}.zip`);
  const extractDir = join(tmpdir(), `bun-${triple}-${version}-x`);
  mkdirSync(extractDir, { recursive: true });

  try {
    await Bun.write(zipPath, new Uint8Array(await res.arrayBuffer()));

    // bsdtar handles zip archives on macOS and Windows.
    const tar = spawnSync("tar", ["-xf", zipPath, "-C", extractDir], { encoding: "utf8" });
    if (tar.status !== 0) {
      throw new Error(`tar extraction failed: ${tar.stderr || tar.stdout || "unknown error"}`);
    }

    const inner = join(extractDir, `bun-${triple}`, isWindows ? "bun.exe" : "bun");
    if (!existsSync(inner)) {
      throw new Error(`archive does not contain expected binary at ${inner}`);
    }

    mkdirSync(RESOURCES_DIR, { recursive: true });
    // copy, not rename: on Windows CI the temp dir and the repo can live on
    // different drives, and renameSync fails with EXDEV across devices
    cpSync(inner, target, { force: true });
    rmSync(inner, { force: true });
    if (!isWindows) chmodSync(target, 0o755);

    console.log(`[fetch-bun] installed ${target}`);
    return { target, skipped: false };
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

let version;
try {
  version = bunVersion();
  console.log(`[fetch-bun] pinning bun v${version}`);
} catch (err) {
  console.error(`[fetch-bun] ${err.message}`);
  process.exit(1);
}

let failed = false;
for (const triple of triples) {
  try {
    await fetchTriple(triple, version);
  } catch (err) {
    failed = true;
    console.error(`[fetch-bun] ${triple}: ${err.message}`);
  }
}

if (failed) process.exit(1);
