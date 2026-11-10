import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LimitsModal.tsx", import.meta.url), "utf8");

test("updates countdowns and refreshes account reports while the dialog is visible", () => {
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 15_000\)/);
  assert.match(source, /if \(!document\.hidden\) void load\(\)/);
  assert.match(source, /order = \["openai-codex", "google-antigravity"\]/);
  assert.match(source, /orderedReports\?\.map/);
});
