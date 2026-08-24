#!/usr/bin/env bun
// Builds the standalone single-executable desktop app with embedded server payload.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const keyPath = join(homedir(), ".omp", "omp-web", "omp-desktop-signing.key");
const passPath = join(homedir(), ".omp", "omp-web", "omp-desktop-signing.password");

const env = { ...process.env };
if (existsSync(keyPath) && existsSync(passPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(passPath, "utf8").trim();
}

console.log("[build-desktop] compiling desktop application binary with tauri...");
const result = spawnSync("bun", ["run", "tauri", "build", "--no-bundle"], {
  cwd: root,
  stdio: "inherit",
  env,
});
if (result.status !== 0) {
  console.error("[build-desktop] tauri build failed");
  process.exit(result.status ?? 1);
}

const exePath =
  process.platform === "win32"
    ? join(root, "src-tauri", "target", "release", "momp.exe")
    : join(root, "src-tauri", "target", "release", "momp");

const payloadPath = existsSync(join(root, "src-tauri", "server_payload.tar"))
  ? join(root, "src-tauri", "server_payload.tar")
  : join(root, "src-tauri", "server_payload.tar.gz");

if (existsSync(exePath) && existsSync(payloadPath)) {
  console.log(`[build-desktop] packing embedded server payload (${payloadPath}) into single executable...`);
  const exeData = readFileSync(exePath);
  const payloadData = readFileSync(payloadPath);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(payloadData.length));
  const magicBuf = Buffer.from("MOMP_SFX");

  const standalone = Buffer.concat([exeData, payloadData, sizeBuf, magicBuf]);
  writeFileSync(exePath, standalone);
  console.log(
    `[build-desktop] standalone executable ready: ${exePath} (${(standalone.length / 1024 / 1024).toFixed(1)} MB)`
  );
} else {
  console.warn("[build-desktop] warning: executable or server payload archive not found for embedding");
}
process.exit(0);
