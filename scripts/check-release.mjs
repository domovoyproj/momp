import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("package.json"));
const npmLock = JSON.parse(read("package-lock.json"));
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoPackage = read("src-tauri/Cargo.toml").split(/\n\[/)[0];
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoPackage)?.[1];
const cargoLockVersion = /name = "momp"\r?\nversion = "([^"]+)"/.exec(read("src-tauri/Cargo.lock"))?.[1];
for (const version of [npmLock.version, npmLock.packages[""].version, tauri.version, cargoVersion, cargoLockVersion]) {
  assert.equal(version, manifest.version, "Package, Tauri and Cargo versions must match");
}
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
assert.match(manifest.packageManager, /^bun@\d+\.\d+\.\d+$/);
assert.ok(Bun.semver.satisfies(Bun.version, manifest.engines.bun), "Bun does not meet the runtime floor");
assert.equal(`bun@${manifest.engines.bun.slice(2)}`, manifest.packageManager);

const sdkVersion = manifest.dependencies["@oh-my-pi/pi-coding-agent"];
const sdkLock = /"@oh-my-pi\/[^"]+?@(\d+\.\d+\.\d+)"/g;
const pinned = [...read("bun.lock").matchAll(sdkLock)].map((match) => match[1]);
assert.ok(pinned.length >= 6, "Missing SDK dependencies in the Bun lockfile");
assert.ok(pinned.every((version) => version === sdkVersion), "Bun lockfile contains mixed OMP versions");
for (const [name, version] of Object.entries(manifest.dependencies)) {
  if (!name.startsWith("@oh-my-pi/")) continue;
  assert.equal(version, sdkVersion);
  assert.equal(npmLock.packages[`node_modules/${name}`].version, sdkVersion);
}

const names = ["AI_MODES.md", "HYBRID_MODE.md", "INSTALLATION.md", "LIVE_VERIFICATION.md", "RELEASE_NOTES.md", "TROUBLESHOOTING.md", "USER_GUIDE.md"];
const releaseNotes = manifest.version.includes("-rc.") ? "docs/release-candidate.md" : "docs/release-notes.md";
const releaseTitle = new RegExp("^# momp " + manifest.version.replaceAll(".", "\\.") + "\\r?$", "m");
const linkedDocuments = ["README.md", releaseNotes, "docs/screenshots/next/README.md"];
assert.match(read(releaseNotes), releaseTitle);
for (const language of ["en", "ru"]) {
  const directory = "docs/" + language;
  assert.deepEqual(readdirSync(join(root, directory)).filter((file) => file.endsWith(".md")).sort(), names);
  assert.match(read(directory + "/RELEASE_NOTES.md"), releaseTitle);
  linkedDocuments.push(...names.map((name) => directory + "/" + name));
}
for (const document of linkedDocuments) {
  const links = read(document).matchAll(/\]\(([^\s)]+)\)|(?:href|src)="([^"]+)"/g);
  for (const [, markdownLink, htmlLink] of links) {
    const target = markdownLink ?? htmlLink;
    if (/^(?:[a-z]+:|#)/i.test(target)) continue;
    const relative = target.split("#", 1)[0];
    assert.ok(existsSync(resolve(root, dirname(document), relative)), "Broken documentation link in " + document + ": " + target);
  }
}
assert.ok(read("README.md").includes("docs/ru/USER_GUIDE.md") && read("README.md").includes("docs/en/USER_GUIDE.md"));
console.log(`PASS versions, OMP lockfiles, and RU/EN documentation for momp ${manifest.version}`);
