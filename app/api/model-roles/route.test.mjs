import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("model-role PUT writes global roles through canonical Settings and re-reads the target scope", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const putSource = source.slice(source.indexOf("export async function PUT"));

  assert.match(putSource, /const runtime = await getOmpRuntime\(\)/);
  assert.match(
    putSource,
    /const settingsToWrite = scope === "global"\s*\?\s*runtime\.settings\s*:\s*await getSettingsForCwd\(result\.cwd\)/s,
  );
  assert.match(putSource, /await settingsToWrite\.flush\(\)/);
  assert.match(putSource, /const settings = await getSettingsForCwd\(result\.cwd\)/);
});
