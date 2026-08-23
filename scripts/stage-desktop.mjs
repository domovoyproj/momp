#!/usr/bin/env bun
// Builds the desktop server payload in src-tauri/server/ with production-only
// dependencies, so the Tauri bundle carries neither devDependencies nor the
// webpack/dev caches (those made the first .app ~4.4GB; the current payload
// is ~700MB). Optional dependencies and client-only packages are excluded
// too — see the install and PRUNE steps below.
//
// Layout produced (src-tauri/server is gitignored):
//   server/.next            production build, distDir via OMP_WEB_DIST_DIR
//   server/node_modules     bun install --production --frozen-lockfile
//   server/bin public next.config.ts package.json bun.lock
//   server/bun-<triple>     Bun runtime(s) for this platform only
//
// The tauri.conf.json resources map points at ./server/*; the Bun binaries
// are declared per-platform (tauri.macos.conf.json / tauri.windows.conf.json,
// merged via JSON Merge Patch), so a bundle never carries a foreign runtime.
//
// Usage: bun scripts/stage-desktop.mjs [--skip-build]

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const server = join(root, "src-tauri", "server");
const skipBuild = process.argv.includes("--skip-build");

// 1. clean slate — when skipping the build, keep the staged .next and wipe
//    everything else so the remaining steps still re-run deterministically
if (skipBuild && !existsSync(join(server, ".next", "BUILD_ID"))) {
  console.error("[stage-desktop] production build missing — run without --skip-build first");
  process.exit(1);
}
if (skipBuild) {
  for (const entry of readdirSync(server)) {
    if (entry !== ".next") rmSync(join(server, entry), { recursive: true, force: true });
  }
} else {
  rmSync(server, { recursive: true, force: true });
  mkdirSync(server, { recursive: true });
}

// 2. static payload
for (const entry of ["bin", "public", "next.config.ts", "package.json", "bun.lock"]) {
  cpSync(join(root, entry), join(server, entry), { recursive: true });
}

// 3. production build straight into the staging dir (the dev `.next/` is
//    never touched, so desktop builds cannot disturb `bun run dev`)
if (!skipBuild) {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OMP_WEB_DIST_DIR: "src-tauri/server/.next" },
  });
  if (build.status !== 0) {
    console.error("[stage-desktop] next build failed");
    process.exit(build.status ?? 1);
  }
}
if (!existsSync(join(server, ".next", "BUILD_ID"))) {
  console.error("[stage-desktop] production build produced no output in src-tauri/server/.next");
  process.exit(1);
}

// 4. drop caches from the staged output (regenerated on the next build)
rmSync(join(server, ".next", "cache"), { recursive: true, force: true });
rmSync(join(server, ".next", "dev"), { recursive: true, force: true });

// 5. production-only dependencies. jiti and the other build tooling stay in
//    devDependencies: Next 16 loads next.config.ts without them, and the
//    only jiti users are the test files, which never ship. `--omit=optional`
//    drops @next/swc-* (all platform variants), @huggingface/transformers +
//    onnxruntime-* (~350MB, local embeddings/TTS workers) and sharp — none
//    are needed by `next start` (verified: the slimmed payload boots and
//    serves every SDK-backed API route).
const install = spawnSync(
  "bun",
  ["install", "--production", "--frozen-lockfile", "--omit=optional"],
  { cwd: server, stdio: "inherit" },
);
if (install.status !== 0) {
  console.error("[stage-desktop] production dependency install failed");
  process.exit(install.status ?? 1);
}

// 5b. client-only / build-time packages that the server runtime never
//     imports. omp-stats (restored below) ships its dashboard client
//     prebuilt, so its build-time deps — lucide-react, chart.js, tailwind
//     and lightningcss — stay out of the bundle.
const PRUNE = [
  "lucide-react",
  "chart.js",
  "react-chartjs-2",
  "@tailwindcss",
  "lightningcss",
  "lightningcss-darwin-arm64",
];
for (const name of PRUNE) {
  rmSync(join(server, "node_modules", name), { recursive: true, force: true });
}

// Pruned packages leave dangling `.bin` symlinks behind; tauri-build's
// resource walker fails on them (the server runtime never invokes .bin).
const binDir = join(server, "node_modules", ".bin");
if (existsSync(binDir)) {
  for (const entry of readdirSync(binDir)) {
    const link = join(binDir, entry);
    try {
      realpathSync(link);
    } catch {
      rmSync(link, { force: true });
    }
  }
}

// 5c. Platform-native packages that the server loads eagerly at runtime are
//     optional deps, so `--omit=optional` above dropped them: @next/swc-*
//     (`next start` auto-downloads a missing SWC through the package manager
//     and fails in a GUI-launched app, breaking the server) and
//     @oh-my-pi/pi-natives-* (workspace tree, PTY). Restore the variants for
//     the host architecture — or both macOS architectures with --universal
//     (the CI universal build needs them) — copying from the full install
//     and fetching the exact version when the host lacks it.
const universal = process.argv.includes("--universal");
// @oh-my-pi/omp-stats is imported eagerly by the slash-command registry
// (stats-dashboard helper); its client UI ships prebuilt inside the package,
// so only the package itself is needed.
const nativeVariants =
  process.platform === "win32"
    ? [
        ["@next/swc-win32-x64-msvc", "next"],
        ["@oh-my-pi/pi-natives-win32-x64", "@oh-my-pi/pi-natives"],
        ["@oh-my-pi/omp-stats", "@oh-my-pi/omp-stats"],
      ]
    : [
        ["@next/swc-darwin-arm64", "next"],
        ["@oh-my-pi/pi-natives-darwin-arm64", "@oh-my-pi/pi-natives"],
        ["@oh-my-pi/omp-stats", "@oh-my-pi/omp-stats"],
        ...(universal
          ? [
              ["@next/swc-darwin-x64", "next"],
              ["@oh-my-pi/pi-natives-darwin-x64", "@oh-my-pi/pi-natives"],
            ]
          : []),
      ];
for (const [name, host] of nativeVariants) {
  const src = join(root, "node_modules", name);
  if (existsSync(src)) {
    cpSync(src, join(server, "node_modules", name), { recursive: true });
    continue;
  }
  let version;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "node_modules", host, "package.json"), "utf8"));
    version = pkg.optionalDependencies?.[name] ?? pkg.version;
  } catch {
    version = undefined;
  }
  if (!version) {
    console.warn(`[stage-desktop] ${name} unavailable (no version hint) — runtime may fail`);
    continue;
  }
  const add = spawnSync("bun", ["add", `${name}@${version}`], { cwd: server, stdio: "inherit" });
  if (add.status !== 0) {
    console.warn(`[stage-desktop] could not fetch ${name}@${version}`);
  }
}

// 6. Bun runtime for this platform (macOS bundles both archs — universal app)
const triples =
  process.platform === "win32" ? ["windows-x64"] : ["darwin-aarch64", "darwin-x64"];
const resources = join(root, "src-tauri", "resources");
for (const triple of triples) {
  const name = triple === "windows-x64" ? "bun-windows-x64.exe" : `bun-${triple}`;
  const src = join(resources, name);
  if (!existsSync(src)) {
    console.error(`[stage-desktop] missing ${src} — run \`bun run desktop:fetch-bun\` first`);
    process.exit(1);
  }
  const dest = join(server, name);
  cpSync(src, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
}

// 7. report
if (process.platform !== "win32") {
  const size = spawnSync("du", ["-sh", server], { encoding: "utf8" });
  console.log(`[stage-desktop] payload ready (${(size.stdout ?? "").trim()})`);
} else {
  console.log("[stage-desktop] payload ready");
}
