import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildInstallPlan,
  compareVersions,
  getOmpWebUpdateStatus,
} = await jiti.import("./omp-updates.ts");

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetcher({ release }) {
  return async (url) => {
    if (url.includes("api.github.com")) return release === null ? response({}, 503) : response(release);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

const release = {
  tag_name: "v1.0.5",
  name: "momp max v1.0.5",
  body: "## Fixed\n\n- A release fix",
  html_url: "https://github.com/domovoyproj/momp/releases/tag/v1.0.5",
  published_at: "2026-08-24T01:32:09Z",
};

test("compares release versions with prerelease ordering", () => {
  assert.equal(compareVersions("v1.0.5", "1.0.4"), 1);
  assert.equal(compareVersions("1.0.5-rc.1", "1.0.5"), -1);
  assert.equal(compareVersions("1.0.5+build.2", "1.0.5+build.1"), 0);
  assert.equal(compareVersions("not-a-version", "1.0.5"), 0);
});

test("reports the latest momp GitHub release with its changelog", async () => {
  const status = await getOmpWebUpdateStatus({
    currentAppVersion: "1.0.4",
    fetcher: fetcher({ release }),
  });

  assert.equal(status.updateAvailable, true);
  assert.equal(status.availability, "installable");
  assert.equal(status.currentAppVersion, "1.0.4");
  assert.equal(status.latestRelease.version, "1.0.5");
  assert.equal(status.latestRelease.body, release.body);
  assert.equal(status.latestRelease.htmlUrl, release.html_url);
  assert.equal(status.latestPackage?.version, "1.0.5");
  assert.equal(status.install.canInstall, true);
  assert.match(status.install.command, /install\.(ps1|sh)/);
  assert.match(status.install.alternateCommand, /install\.(ps1|sh)/);
});

test("reports up-to-date when the release matches the running version", async () => {
  const status = await getOmpWebUpdateStatus({
    currentAppVersion: "1.0.5",
    fetcher: fetcher({ release }),
  });

  assert.equal(status.updateAvailable, false);
  assert.equal(status.availability, "up-to-date");
  assert.equal(status.install.canInstall, false);
});

test("surfaces an error when GitHub is unavailable", async () => {
  await assert.rejects(
    getOmpWebUpdateStatus({ currentAppVersion: "1.0.4", fetcher: fetcher({ release: null }) }),
  );
});

test("self-update can be disabled without hiding the installer command", () => {
  const plan = buildInstallPlan({
    currentAppVersion: "1.0.4",
    latestVersion: "1.0.5",
    env: { MOMP_WEB_DISABLE_SELF_UPDATE: "1" },
  });

  assert.equal(plan.canInstall, false);
  assert.equal(plan.reason, "disabled");
  assert.match(plan.command, /install\.(ps1|sh)/);
  assert.equal(plan.packageVersion, "1.0.5");
});
