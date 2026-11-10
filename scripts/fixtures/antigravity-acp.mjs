import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

// The executable is compiled into a disposable directory by the tests.
const account = join(dirname(process.execPath), "fixture-google-sign-in");
const write = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
const reply = (id, result = {}) => write({ id, result });
const failure = (id, code, message) => write({ id, error: { code, message } });
const update = (sessionId, sessionUpdate, body) => write({ method: "session/update", params: { sessionId, update: { sessionUpdate, ...body } } });
const chunk = (sessionId, text, role = "agent_message_chunk") => update(sessionId, role, { content: { type: "text", text } });
let cwd;
let model = "gemini-fixture-pro";
let reasoning = "medium";
let pending;

const options = () => [
  { type: "select", id: "model", name: "Model", category: "model", currentValue: model, options: [
    { group: "gemini", name: "Gemini", options: [{ value: "gemini-fixture-pro", name: "Gemini Pro fixture" }, { value: "gemini-fixture-flash", name: "Gemini Flash fixture" }] },
  ] },
  { type: "select", id: "effort", name: "Thinking level", category: "thought_level", currentValue: reasoning,
    options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
  { type: "select", id: "mode", name: "Execution mode", category: "mode", currentValue: "ask", options: [{ value: "skip", name: "Skip prompts" }] },
];

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params, result } = JSON.parse(line);
  if (method === "initialize") {
    if (!process.argv.includes("--sandbox") || params.clientCapabilities?.fs || params.clientCapabilities?.terminal
      || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) {
      failure(id, -32602, "Unsafe client launch");
      continue;
    }
    reply(id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: "oauth-personal", name: "Log in with Google" }] });
  } else if (method === "authenticate") {
    if (params.methodId !== "oauth-personal") failure(id, -32602, "Unknown sign-in method");
    else {
      if (existsSync(`${account}-hold`)) {
        await Bun.write(`${account}-started`, String(process.pid));
        await Bun.sleep(30_000);
      }
      await Bun.write(account, "authenticated mock account");
      reply(id);
    }
  } else if (method === "session/new" || method === "session/load") {
    if (!existsSync(account)) { failure(id, -32000, "Authentication required"); continue; }
    if (!Array.isArray(params.mcpServers) || params.mcpServers.length) { failure(id, -32602, "Unexpected MCP server"); continue; }
    cwd = params.cwd;
    if (method === "session/new") {
      const sessionId = `fixture-${crypto.randomUUID()}`;
      await Bun.write(join(dirname(account), `.${sessionId}`), "mock history");
      reply(id, { sessionId, configOptions: options() });
    } else if (/^fixture-[a-f0-9-]+$/.test(params.sessionId) && existsSync(join(dirname(account), `.${params.sessionId}`))) {
      chunk(params.sessionId, "History replay should not duplicate the saved response.");
      reply(id, { configOptions: options() });
    } else failure(id, -32002, "Session not found");
  } else if (method === "session/set_config_option") {
    if (params.configId === "model") model = params.value;
    else if (params.configId === "effort") reasoning = params.value;
    else { failure(id, -32602, "Unknown config"); continue; }
    reply(id, { configOptions: options() });
  } else if (method === "session/prompt") {
    const { sessionId, prompt } = params;
    const text = prompt[0].text;
    if (text.includes("quota exhaustion")) { failure(id, 429, "RESOURCE_EXHAUSTED with PRIVATE-ERROR-DATA"); continue; }
    if (text.includes("simulate disconnect")) { chunk(sessionId, "Saved before disconnect."); await Bun.sleep(600); process.exit(1); }
    update(sessionId, "session_info_update", { title: "Review the workspace greeting" });
    update(sessionId, "usage_update", { used: 1420, size: 32000 });
    update(sessionId, "plan", { entries: [{ content: "Inspect greeting.txt and check its repository status", status: "completed", priority: "medium" }] });
    chunk(sessionId, "I’ll inspect the tracked greeting before editing.", "agent_thought_chunk");
    chunk(sessionId, "I found the workspace greeting.");
    await Bun.sleep(500);
    if (text.includes("review edit") || text.includes("wait for cancellation")) {
      pending = { id, sessionId };
      update(sessionId, "tool_call", { toolCallId: "edit-greeting", title: "Edit greeting.txt", kind: "edit", status: "pending" });
      write({ id: "fixture-permission", method: "session/request_permission", params: { sessionId,
        toolCall: { toolCallId: "edit-greeting", title: "Edit greeting.txt" }, options: [
          { optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
        ] } });
    } else {
      chunk(sessionId, " The repository is ready for review.");
      reply(id, { stopReason: "end_turn" });
    }
  } else if (method === "session/cancel" && pending) {
    const cancelled = pending;
    pending = undefined;
    reply(cancelled.id, { stopReason: "cancelled" });
  } else if (id === "fixture-permission" && pending) {
    const { sessionId, id: promptId } = pending;
    pending = undefined;
    if (result?.outcome?.optionId === "allow") {
      const path = join(cwd, "greeting.txt");
      const before = await Bun.file(path).text();
      const after = "Hello from Gemini\n";
      await Bun.write(path, after);
      update(sessionId, "tool_call_update", { toolCallId: "edit-greeting", status: "completed",
        content: [{ type: "diff", path: "greeting.txt", oldText: before, newText: after }] });
      chunk(sessionId, " The approved edit is in greeting.txt.");
    } else {
      update(sessionId, "tool_call_update", { toolCallId: "edit-greeting", status: "failed" });
      chunk(sessionId, " The edit was denied.");
    }
    reply(promptId, { stopReason: "end_turn" });
  } else if (typeof id === "number") failure(id, -32601, "Unsupported fixture method");
}
