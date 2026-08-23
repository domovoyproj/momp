import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_SLASH_COMMANDS_INTERNAL } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./rpc-manager.ts");
  } catch {
    return import("./rpc-manager.ts");
  }
}

const { getAvailableSlashCommands } = await loadSubject();

function makeSession(promptTemplates = []) {
  return {
    extensionRunner: undefined,
    customCommands: [],
    mcpPromptCommands: [],
    skills: [],
    skillsSettings: { enableSkillCommands: false },
    setSlashCommands() {},
    sessionManager: { getCwd: () => process.cwd() },
    promptTemplates,
  };
}

test("advertises browser-native fork and handoff with canonical metadata", async () => {
  const commands = await getAvailableSlashCommands(makeSession());
  const byName = new Map(commands.map((command) => [command.name, command]));

  assert.equal(byName.get("fork")?.source, "builtin");
  assert.equal(byName.get("fork")?.description, "Create a new fork from a previous message");
  assert.equal(byName.get("handoff")?.source, "builtin");
  assert.equal(byName.get("handoff")?.description, "Hand off session context to a new session");
  assert.equal(byName.get("handoff")?.input?.hint, "[focus instructions]");
  assert.equal(new Set(byName.keys()).size, commands.length);
});

test("advertises shared SDK builtins but not TUI-only commands", async () => {
  const commands = await getAvailableSlashCommands(makeSession());
  const byName = new Map(commands.map((command) => [command.name, command]));

  // Shared text/ACP builtins come through the SDK discovery pipeline.
  assert.equal(byName.get("compact")?.source, "builtin");
  assert.equal(byName.get("compact")?.description, "Compact the conversation");

  // TUI-only commands without a shared handler are not advertised.
  assert.equal(byName.has("plan"), false);
  assert.equal(byName.has("settings"), false);
});

test("every advertised SDK builtin has an executable browser path", async () => {
  const commands = await getAvailableSlashCommands(makeSession());
  const browserNative = new Set(["fork", "handoff"]);
  const canonicalByName = new Map(BUILTIN_SLASH_COMMANDS_INTERNAL.map((command) => [command.name, command]));

  for (const command of commands.filter((entry) => entry.source === "builtin")) {
    const canonical = canonicalByName.get(command.name);
    assert.ok(canonical, `/${command.name} must come from the canonical SDK registry`);
    assert.equal(
      Boolean(canonical.handle) || browserNative.has(command.name),
      true,
      `/${command.name} is advertised without a shared or browser-native handler`,
    );
  }

  for (const command of BUILTIN_SLASH_COMMANDS_INTERNAL.filter((entry) => entry.handle)) {
    assert.equal(
      commands.some((entry) => entry.source === "builtin" && entry.name === command.name),
      true,
      `shared SDK command /${command.name} must remain available`,
    );
  }
});

test("retains prompt templates alongside the SDK command registry", async () => {
  const commands = await getAvailableSlashCommands(makeSession([
    { name: "review", description: "Review the current change", source: "/tmp/review.md" },
  ]));

  assert.deepEqual(
    commands.find((command) => command.name === "review"),
    {
      name: "review",
      description: "Review the current change",
      source: "prompt",
      path: "/tmp/review.md",
    },
  );
});
