"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open": { type: "boolean" },
      // Turns the password lock on for this run and every later one, asking for
      // a password on the terminal when none has been set yet.
      authenticated: { type: "boolean" },
      // Recovery from the machine itself: replaces the stored password without
      // needing the old one.
      "reset-password": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: cliArgs.port ?? env.PORT ?? "30141",
    hostname: cliArgs.hostname ?? env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMP_WEB_NO_OPEN),
    authenticated: Boolean(cliArgs.authenticated) || isEnabled(env.OMP_WEB_AUTHENTICATED),
    resetPassword: Boolean(cliArgs["reset-password"]),
  };
}

module.exports = { parseLaunchOptions };
