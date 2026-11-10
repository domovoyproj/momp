import assert from "node:assert/strict";
import test from "node:test";
import { fetchUsageReportViews } from "./limits-checker.ts";

test("preserves missing amounts, reported reset time and model scope without serializing raw metadata", async () => {
  const previous = globalThis.__ompRuntimePromise;
  const reset = 1_795_000_000_000;
  const report = {
    provider: "openai-codex", fetchedAt: reset - 30_000,
    metadata: { email: "synthetic@example.invalid", token: "not-for-the-client" },
    raw: { accessToken: "not-for-the-client" },
    limits: [
      { id: "unknown", label: "Unknown", amount: { unit: "unknown" }, scope: { provider: "openai-codex" } },
      { id: "weekly", label: "Weekly", status: "exhausted", amount: { unit: "percent", used: 100 },
        scope: { provider: "openai-codex", modelId: "gpt-test" }, window: { id: "weekly", label: "Weekly", resetsAt: reset } },
    ],
  };
  globalThis.__ompRuntimePromise = Promise.resolve({ authStorage: { usage: { reports: async () => [report] } } });
  try {
    const [view] = await fetchUsageReportViews();
    assert.equal(view.limits[0].usedFraction, null);
    assert.equal(view.limits[1].usedFraction, 1);
    assert.equal(view.limits[1].resetsAt, reset);
    assert.equal(view.limits[1].modelId, "gpt-test");
    assert.equal(view.fetchedAt, report.fetchedAt);
    assert.doesNotMatch(JSON.stringify(view), /not-for-the-client/);
  } finally { globalThis.__ompRuntimePromise = previous; }
});
