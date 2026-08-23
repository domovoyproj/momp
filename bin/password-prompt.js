"use strict";

/**
 * Terminal password entry for `omp-web --authenticated` and `--reset-password`.
 *
 * Reads in raw mode and echoes nothing rather than going through readline's
 * private output hook, so the same code works under Node and under Bun.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validatePassword } = require("./web-auth-store");

const ETX = "\u0003"; // Ctrl+C
const EOT = "\u0004"; // Ctrl+D
const BACKSPACE = "\u007f";
const ESCAPE = "\u001b";

/** Thrown when the operator interrupts the prompt (Ctrl+C / Ctrl+D). */
class PromptAbortedError extends Error {
  constructor() {
    super("Password entry cancelled");
    this.name = "PromptAbortedError";
  }
}

/** Whether a person is actually there to answer. Services and pipes are not. */
function isInteractive(stdin = process.stdin, stdout = process.stdout) {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function promptHidden(query) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    const { stdin, stdout } = process;
    if (!isInteractive()) {
      rejectPrompt(new Error("A terminal is required to enter a password."));
      return;
    }

    stdout.write(query);
    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const finish = (result, error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
      if (error) rejectPrompt(error);
      else resolvePrompt(result);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(value);
        // Ctrl+C always cancels; Ctrl+D cancels an empty entry, the usual EOF.
        if (char === ETX || (char === EOT && value.length === 0)) {
          return finish(undefined, new PromptAbortedError());
        }
        if (char === BACKSPACE || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        // An escape introduces a key sequence (arrows, function keys). Nothing
        // in one belongs in a password, and the rest of the chunk is its body.
        if (char === ESCAPE) return;
        if (char >= " ") value += char;
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * Ask for a new password twice, re-asking until the two entries agree and the
 * result is acceptable to the credential store.
 */
async function readNewPassword(options = {}) {
  const prompt = options.prompt ?? "New password: ";
  for (;;) {
    const password = await promptHidden(prompt);
    const invalid = validatePassword(password);
    if (invalid) {
      process.stdout.write(`${invalid}\n`);
      continue;
    }

    const confirmation = await promptHidden("Confirm password: ");
    if (confirmation !== password) {
      process.stdout.write("The passwords do not match. Try again.\n");
      continue;
    }
    return password;
  }
}

module.exports = { PromptAbortedError, isInteractive, promptHidden, readNewPassword };
