import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const store = require("../bin/web-auth-store.js");

/** Keeps scrypt cheap: these tests exercise the protocol, not the cost factor. */
const PARAMS = { cost: 16, keyLength: 32 };
const PASSWORD = "a-long-enough-password";

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-auth-"));
  const options = { file: join(dir, "omp-web-auth.json"), env: {}, params: PARAMS };
  try {
    return run(options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("starts unlocked when no credential file exists", () => {
  withStore((options) => {
    const status = store.getWebAuthStatus(options);
    assert.equal(status.enabled, false);
    assert.equal(status.configured, false);
    assert.equal(status.source, "none");
    assert.equal(store.resolveWebAuthPolicy(options).mode, "open");
  });
});

test("stores the password as a scrypt digest and never in plaintext", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);

    const contents = readFileSync(options.file, "utf8");
    assert.equal(contents.includes(PASSWORD), false);
    const parsed = JSON.parse(contents);
    assert.equal(parsed.password.algorithm, "scrypt");
    assert.ok(parsed.password.salt.length > 0);
    assert.ok(parsed.password.hash.length > 0);
  });
});

test("writes the credential file with owner-only permissions", { skip: process.platform === "win32" }, () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    assert.equal(statSync(options.file).mode & 0o777, 0o600);
  });
});

test("verifies the stored password and rejects everything else", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    assert.equal(store.verifyWebPassword(PASSWORD, options), true);
    assert.equal(store.verifyWebPassword(`${PASSWORD} `, options), false);
    assert.equal(store.verifyWebPassword("", options), false);
    assert.equal(store.verifyWebPassword(undefined, options), false);
  });
});

test("a fresh salt is drawn per password, so the same secret hashes differently", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const first = JSON.parse(readFileSync(options.file, "utf8")).password;
    store.setWebPassword(PASSWORD, options);
    const second = JSON.parse(readFileSync(options.file, "utf8")).password;

    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
    assert.equal(store.verifyWebPassword(PASSWORD, options), true);
  });
});

test("the lock can be switched off and back on without losing the password", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);

    const disabled = store.setWebPasswordEnabled(false, options);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.stored, true);
    assert.equal(store.resolveWebAuthPolicy(options).mode, "open");

    const enabled = store.setWebPasswordEnabled(true, options);
    assert.equal(enabled.enabled, true);
    assert.equal(store.resolveWebAuthPolicy(options).mode, "stored");
    assert.equal(store.verifyWebPassword(PASSWORD, options), true);
  });
});

test("refuses to lock the server with no password to unlock it", () => {
  withStore((options) => {
    assert.throws(() => store.setWebPasswordEnabled(true, options), /Set a password/);
  });
});

test("clearing the password unlocks the server", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const status = store.clearWebPassword(options);

    assert.equal(status.configured, false);
    assert.equal(status.enabled, false);
    assert.equal(store.resolveWebAuthPolicy(options).mode, "open");
    assert.equal(readFileSync(options.file, "utf8").includes("\"password\""), false);
  });
});

test("OMP_WEB_PASSWORD overrides the stored credential", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const env = { OMP_WEB_PASSWORD: "from-the-environment" };

    const status = store.getWebAuthStatus({ ...options, env });
    assert.equal(status.source, "environment");
    assert.equal(status.managedByEnvironment, true);
    assert.equal(status.enabled, true);

    assert.equal(store.verifyWebPassword("from-the-environment", { ...options, env }), true);
    assert.equal(store.verifyWebPassword(PASSWORD, { ...options, env }), false);
  });
});

test("an unparsable credential file fails closed instead of unlocking the server", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    writeFileSync(options.file, "{ not json");

    assert.equal(store.resolveWebAuthPolicy(options).mode, "unavailable");
    assert.equal(store.getWebAuthStatus(options).unreadable, true);
  });
});

test("a locked config whose digest is unusable fails closed", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const config = JSON.parse(readFileSync(options.file, "utf8"));
    config.password.cost = 12345; // not a power of two
    writeFileSync(options.file, JSON.stringify(config));

    assert.equal(store.resolveWebAuthPolicy(options).mode, "unavailable");
  });
});

test("rejects passwords too short to be worth storing", () => {
  assert.match(store.validatePassword("short"), /at least/);
  assert.match(store.validatePassword("        "), /whitespace/);
  assert.equal(store.validatePassword(undefined), "A password is required.");
  assert.equal(store.validatePassword(PASSWORD), null);
  withStore((options) => {
    assert.throws(() => store.setWebPassword("short", options), /at least/);
  });
});

test("a recovery code sets a new password and is spent in the process", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);

    const issued = store.issueRecoveryCode(options);
    assert.equal(issued.ok, true);
    assert.match(issued.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // The code itself is never persisted in the clear.
    assert.equal(readFileSync(options.file, "utf8").includes(issued.code), false);

    const result = store.consumeRecoveryCode(issued.code, "brand-new-password", options);
    assert.equal(result.ok, true);
    assert.equal(store.verifyWebPassword("brand-new-password", options), true);
    assert.equal(store.verifyWebPassword(PASSWORD, options), false);

    const replay = store.consumeRecoveryCode(issued.code, "another-password", options);
    assert.deepEqual(replay, { ok: false, reason: "no-code" });
  });
});

test("recovery codes are read back forgivingly", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const issued = store.issueRecoveryCode(options);

    const typed = issued.code.toLowerCase().replace(/-/g, " ");
    assert.equal(store.consumeRecoveryCode(typed, "brand-new-password", options).ok, true);
  });
});

test("a wrong recovery code is spent after a bounded number of attempts", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    store.issueRecoveryCode(options);

    for (let attempt = store.RECOVERY_MAX_ATTEMPTS; attempt > 1; attempt -= 1) {
      const result = store.consumeRecoveryCode("0000-0000-0000", "brand-new-password", options);
      assert.equal(result.reason, "invalid-code");
      assert.equal(result.remainingAttempts, attempt - 1);
    }

    assert.equal(store.consumeRecoveryCode("0000-0000-0000", "brand-new-password", options).remainingAttempts, 0);
    assert.equal(store.consumeRecoveryCode("0000-0000-0000", "brand-new-password", options).reason, "no-code");
    assert.equal(store.verifyWebPassword(PASSWORD, options), true);
  });
});

test("an expired recovery code is refused and discarded", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const issued = store.issueRecoveryCode(options);

    const later = issued.expiresAt + 1;
    assert.equal(store.consumeRecoveryCode(issued.code, "brand-new-password", { ...options, now: later }).reason, "expired");
    assert.equal(store.consumeRecoveryCode(issued.code, "brand-new-password", options).reason, "no-code");
    assert.equal(store.verifyWebPassword(PASSWORD, options), true);
  });
});

test("recovery codes cannot be minted in a tight loop", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    assert.equal(store.issueRecoveryCode(options).ok, true);

    const throttled = store.issueRecoveryCode(options);
    assert.equal(throttled.ok, false);
    assert.equal(throttled.reason, "throttled");
    assert.ok(throttled.retryAfterMs > 0);
  });
});

test("setting a password invalidates a pending recovery code", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const issued = store.issueRecoveryCode(options);
    store.setWebPassword("a-different-password", options);

    assert.equal(store.consumeRecoveryCode(issued.code, "brand-new-password", options).reason, "no-code");
  });
});

test("a valid code still rejects an unacceptable new password, without being spent", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    const issued = store.issueRecoveryCode(options);

    const result = store.consumeRecoveryCode(issued.code, "short", options);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-password");
    assert.equal(store.consumeRecoveryCode(issued.code, "brand-new-password", options).ok, true);
  });
});

test("resolves the credential path from the agent directory, and honours the override", () => {
  assert.equal(
    store.resolveWebAuthFile({ PI_CODING_AGENT_DIR: "/srv/omp/agent" }),
    join("/srv/omp/agent", store.WEB_AUTH_FILENAME),
  );
  assert.equal(store.resolveWebAuthFile({ OMP_WEB_AUTH_FILE: "/srv/creds.json" }), "/srv/creds.json");
  assert.match(store.resolveAgentDir({}), /\.omp[/\\]agent$/);
  assert.match(store.resolveAgentDir({ OMP_PROFILE: "work" }), /\.omp[/\\]profiles[/\\]work[/\\]agent$/);
  assert.match(store.resolveAgentDir({ OMP_PROFILE: "  " }), /\.omp[/\\]agent$/);
});

test("a new password replaces a credential file that cannot be parsed", () => {
  withStore((options) => {
    store.setWebPassword(PASSWORD, options);
    writeFileSync(options.file, "{ not json");
    // Everything else refuses to touch a file it cannot read, so a mutation can
    // never silently drop a credential and unlock the server.
    assert.throws(() => store.setWebPasswordEnabled(false, options), /reset-password/);
    assert.throws(() => store.issueRecoveryCode(options), /reset-password/);

    // `omp-web --reset-password` is the way out, so it has to work here.
    const status = store.setWebPassword("a-replacement-password", options);
    assert.equal(status.enabled, true);
    assert.equal(store.resolveWebAuthPolicy(options).mode, "stored");
    assert.equal(store.verifyWebPassword("a-replacement-password", options), true);
  });
});
