import assert from "node:assert/strict";
import test from "node:test";
import { loadCallback, sourceTree } from "./source-test-helpers.mjs";

const tree = sourceTree(new URL("./AppShell.tsx", import.meta.url));

function harness() {
  const state = { selectedSession: { id: "existing", cwd: "/project" }, newSessionCwd: null, sessionKey: 10, chatTabs: [] };
  const context = {
    ...state,
    isMobile: false,
    invalidations: 0,
    router: { replace: (url) => { state.url = url; } },
    hydrateSelectedSession: () => {},
    setRefreshKey: () => {},
    setBranchTree: () => {},
    setBranchActiveLeafId: () => {},
    setSystemPrompt: () => {},
    setActiveTopPanel: () => {},
    setSidebarOpen: () => {},
    setTimeout: (callback) => callback(),
    handleSelectSession: () => { state.selectedExisting = true; },
  };
  for (const field of Object.keys(state)) {
    context[`set${field[0].toUpperCase()}${field.slice(1)}`] = (update) => {
      state[field] = typeof update === "function" ? update(state[field]) : update;
    };
  }
  context.invalidateWorkspaceRestore = () => { context.invalidations += 1; };
  context.handleNewSession = loadCallback(tree, "handleNewSession", context);
  context.handleSelectChatTab = loadCallback(tree, "handleSelectChatTab", context);
  return { state, context };
}

test("selecting a provisional tab remounts the chat and clears the previous session URL", () => {
  const { state, context } = harness();
  context.handleSelectChatTab({ id: "new:/project", cwd: "/project", name: "New" });
  assert.equal(state.selectedSession, null);
  assert.equal(state.newSessionCwd, "/project");
  assert.equal(state.sessionKey, 11);
  assert.equal(context.invalidations, 1);
  assert.equal(state.url, "/");
});

test("session promotion replaces the provisional tab rather than leaving an obsolete composer", () => {
  const { state, context } = harness();
  state.chatTabs = [{ id: "new:/project", cwd: "/project", name: "New" }];
  const promote = loadCallback(tree, "handleSessionCreated", context);
  promote({ id: "created", cwd: "/project", name: "Created" });
  assert.equal(state.chatTabs.length, 1);
  assert.equal(state.chatTabs[0].id, "created");
});

test("closing another project's provisional tab does not switch the active composer", () => {
  const { state, context } = harness();
  context.selectedSession = null;
  context.newSessionCwd = "/project";
  context.chatTabs = state.chatTabs = [
    { id: "existing", cwd: "/project", name: "Existing" },
    { id: "new:/other", cwd: "/other", name: "Other" },
  ];
  const close = loadCallback(tree, "handleCloseChatTab", context);
  close("new:/other");
  assert.equal(state.selectedExisting, undefined);
  assert.equal(state.chatTabs.length, 1);
});

test("ask attention notifications have a body without requiring a title field", () => {
  let notification;
  const notify = loadCallback(tree, "handleAttentionNeeded", {
    shouldShowBrowserNotification: () => true,
    claimExtensionAttentionNotification: () => true,
    notifiedAttentionRequestIdsRef: { current: new Set() },
    selectedSession: { id: "session" },
    translate: (key) => key,
    deliverSessionNotification: (value) => { notification = value; },
  });
  notify({ method: "ask", id: "question", questions: [] });
  assert.equal(notification.body, "i18n.extensionInputNeeded");
});
