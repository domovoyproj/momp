#!/usr/bin/env bun
/**
 * sync-version.mjs — keep the desktop (Tauri) version aligned with the npm
 * package version.
 *
 * Reads "version" from package.json and writes it into:
 *   - src-tauri/tauri.conf.json — the top-level "version" field, via a JSON
 *     parse/round-trip (JSON.stringify(..., null, 2)) preserving all other
 *     fields.
 *   - src-tauri/Cargo.toml — the `version = "x.y.z"` line inside the [package]
 *     section only, via a regex replace; everything else in the file is
 *     preserved byte-for-byte.
 *
 * Idempotent: no writes happen when the versions already match.
 * Exits non-zero with a clear message if src-tauri/tauri.conf.json or
 * src-tauri/Cargo.toml does not exist.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const PKG_PATH = join(REPO_ROOT, "package.json");
const CONF_PATH = join(REPO_ROOT, "src-tauri", "tauri.conf.json");
const CARGO_PATH = join(REPO_ROOT, "src-tauri", "Cargo.toml");

for (const [label, path] of [
  ["src-tauri/tauri.conf.json", CONF_PATH],
  ["src-tauri/Cargo.toml", CARGO_PATH],
]) {
  if (!existsSync(path)) {
    console.error(`[sync-version] ${label} not found at ${path} — nothing to sync`);
    process.exit(1);
  }
}

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const version = pkg.version;
if (typeof version !== "string" || version.length === 0) {
  console.error(`[sync-version] package.json has no usable "version" field`);
  process.exit(1);
}

// --- src-tauri/tauri.conf.json ---
const conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));
if (conf.version === version) {
  console.log(`[sync-version] tauri.conf.json already at ${version}`);
} else {
  conf.version = version;
  writeFileSync(CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`);
  console.log(`[sync-version] tauri.conf.json version -> ${version}`);
}

// --- src-tauri/Cargo.toml ([package] section only) ---
const cargo = readFileSync(CARGO_PATH, "utf8");
const lines = cargo.split("\n");
let inPackage = false;
let sawVersionLine = false;
let cargoChanged = false;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed.startsWith("[")) {
    // Any section header (including [package.metadata.*]) ends the [package] section.
    inPackage = trimmed === "[package]";
    continue;
  }
  if (!inPackage) continue;
  if (/^version\s*=/.test(trimmed)) {
    sawVersionLine = true;
    const updated = lines[i].replace(
      /^(\s*version\s*=\s*)"[^"]*"/,
      `$1"${version}"`,
    );
    if (updated !== lines[i]) {
      lines[i] = updated;
      cargoChanged = true;
    }
  }
}

if (!sawVersionLine) {
  console.error(`[sync-version] no version = "..." line found in the [package] section of ${CARGO_PATH}`);
  process.exit(1);
}

if (cargoChanged) {
  writeFileSync(CARGO_PATH, lines.join("\n"));
  console.log(`[sync-version] Cargo.toml [package] version -> ${version}`);
} else {
  console.log(`[sync-version] Cargo.toml [package] already at ${version}`);
}
