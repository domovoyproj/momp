import assert from "node:assert/strict";
import test from "node:test";
import { githubRepositoryUrl } from "./github-repository.ts";
import { sortFeaturedProviders } from "./featured-providers.ts";

test("normalizes GitHub remotes and never returns embedded credentials", () => {
  for (const remote of ["git@github.com:domovoyproj/momp.git", "https://github.com/domovoyproj/momp.git",
    "ssh://git@github.com/domovoyproj/momp.git", "https://user:password@github.com/domovoyproj/momp.git"]) {
    assert.equal(githubRepositoryUrl(remote), "https://github.com/domovoyproj/momp");
  }
});

test("rejects non-GitHub, executable and malformed remote URLs", () => {
  for (const remote of ["javascript:alert(1)", "https://github.com.evil.test/org/repo", "file:///local/repo",
    "https://github.com/org/repo/tree/main", "not-a-remote", "https://github.com/org/..", "http://github.com/org/repo"]) {
    assert.equal(githubRepositoryUrl(remote), null);
  }
});

test("featured providers sort first without mutating the catalog", () => {
  const providers = [{ id: "zai" }, { id: "google-antigravity" }, { id: "github-copilot" }, { id: "openai-codex" }];
  assert.deepEqual(sortFeaturedProviders(providers).map((provider) => provider.id),
    ["openai-codex", "github-copilot", "google-antigravity", "zai"]);
  assert.equal(providers[0].id, "zai");
});
