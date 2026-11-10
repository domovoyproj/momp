import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderReleaseNotes } from "./render-release-notes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commit = "1234567890abcdef1234567890abcdef12345678";
const settings = { inputPath: "docs/release-candidate.md", serverUrl: "https://github.com", repository: "domovoyproj/momp", commit };
const prefix = "https://github.com/domovoyproj/momp/blob/" + commit + "/";

test("candidate EN/RU guides, verification and screenshot galleries link to the verified commit", () => {
  const source = readFileSync(join(root, settings.inputPath), "utf8");
  const output = renderReleaseNotes(source, settings);
  for (const path of [
    "docs/en/INSTALLATION.md", "docs/ru/INSTALLATION.md", "docs/en/LIVE_VERIFICATION.md", "docs/ru/LIVE_VERIFICATION.md",
    "docs/IMPLEMENTATION_PROGRESS.md", "docs/screenshots/xbox-dns/README.md", "docs/screenshots/next/README.md",
  ]) assert.ok(output.includes("](" + prefix + path + ")"), path);
  assert.equal(/\]\((?:en|ru|screenshots)\//.test(output), false);
  assert.ok(output.includes("## English") && output.includes("## Русский"));
  assert.equal(readFileSync(join(root, settings.inputPath), "utf8"), source);
});

test("spaces, Unicode, escaped parentheses, titles and relative traversal inside the repository are encoded", () => {
  const input = '[Guide](<en/My Guide.md> "Read this")\n![Screen](screenshots/a%20b.png)\n[RU](ru/Вход.md#step-1)\n[Root](../README.md)\n[Paren](en/Guide\\(draft\\).md)\n[Title](en/Guide.md "Title (with parenthesis)")';
  const output = renderReleaseNotes(input, settings);
  assert.ok(output.includes('<' + prefix + 'docs/en/My%20Guide.md> "Read this"'));
  assert.ok(output.includes("](" + prefix + "docs/screenshots/a%20b.png)"));
  assert.ok(output.includes("](" + prefix + "docs/ru/%D0%92%D1%85%D0%BE%D0%B4.md#step-1)"));
  assert.ok(output.includes("](" + prefix + "README.md)"));
  assert.ok(output.includes("](" + prefix + "docs/en/Guide%28draft%29.md)"));
  assert.ok(output.includes('](' + prefix + 'docs/en/Guide.md "Title (with parenthesis)")'));
});

test("absolute URLs, anchors and code examples remain untouched; reference links are pinned", () => {
  const unchanged = '[Web](https://example.com/a?b=1#c)\n[Anchor](#english)\n[Email](mailto:team@example.com)\n[CDN](//example.com/a)\n`[literal](en/example.md)`\n```md\n[example](en/example.md)\n```\n    [indented](en/example.md)';
  assert.equal(renderReleaseNotes(unchanged, settings), unchanged);
  assert.equal(renderReleaseNotes('[guide]: <en/My Guide.md> "Install"\n[Read][guide]', settings), '[guide]: <' + prefix + 'docs/en/My%20Guide.md> "Install"\n[Read][guide]');
});

test("unsafe traversal and ambiguous release metadata fail before rendering", () => {
  for (const target of ["../../outside.md", "%2e%2e/%2e%2e/outside.md", "/../outside.md", "en/%5coutside.md", "en/%00outside.md"]) {
    assert.throws(() => renderReleaseNotes("[bad](" + target + ")", settings));
  }
  for (const changes of [
    { inputPath: "../outside.md" }, { commit: "main" }, { repository: "../repo" },
    { serverUrl: "http://github.com" }, { serverUrl: "https://user:secret@github.com" },
  ]) assert.throws(() => renderReleaseNotes("[guide](en/INSTALLATION.md)", { ...settings, ...changes }));
});

test("CLI runs on Node without dependencies and writes separate rendered notes", t => {
  const directory = mkdtempSync(join(tmpdir(), "momp-release-notes-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "docs"));
  mkdirSync(join(directory, "release"));
  const source = "[Install](en/INSTALLATION.md)\n[Установка](ru/INSTALLATION.md)\n";
  writeFileSync(join(directory, "docs", "candidate.md"), source);
  const script = join(root, "scripts", "render-release-notes.mjs");
  const env = { ...process.env, GITHUB_SERVER_URL: settings.serverUrl, GITHUB_REPOSITORY: settings.repository, VERIFIED_COMMIT: commit };
  execFileSync("node", [script, "docs/candidate.md", "release/notes.md"], { cwd: directory, env, windowsHide: true, stdio: "pipe" });
  assert.equal(readFileSync(join(directory, "docs", "candidate.md"), "utf8"), source);
  assert.equal(readFileSync(join(directory, "release", "notes.md"), "utf8"), "[Install](" + prefix + "docs/en/INSTALLATION.md)\n[Установка](" + prefix + "docs/ru/INSTALLATION.md)\n");
  assert.throws(() => execFileSync("node", [script, "docs/candidate.md", "docs/candidate.md"], { cwd: directory, env, windowsHide: true, stdio: "pipe" }));
  assert.equal(readFileSync(join(directory, "docs", "candidate.md"), "utf8"), source);
});
