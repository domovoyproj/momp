#!/usr/bin/env bun
// Wraps `tauri build` with the updater signing key loaded from
// ~/.omp/omp-web/ (the same key CI gets from secrets), so local desktop
// builds produce signed updater artifacts without shell env gymnastics.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const keyPath = join(homedir(), ".omp", "omp-web", "omp-desktop-signing.key");
const passPath = join(homedir(), ".omp", "omp-web", "omp-desktop-signing.password");

const env = { ...process.env };
if (existsSync(keyPath) && existsSync(passPath)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(passPath, "utf8").trim();
} else if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error(
    "[build-desktop] updater signing key not found: set TAURI_SIGNING_PRIVATE_KEY or " +
      "run `bun run desktop:signer generate` (keys land in ~/.omp/omp-web/)",
  );
  process.exit(1);
}

const result = spawnSync("bun", ["run", "tauri", "build"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
