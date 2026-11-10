import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSync, lockSync } from "proper-lockfile";
import type { RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from "@oh-my-pi/pi-utils/acp";
import { antigravityError, AntigravityFailure, launchAntigravity, withAcpDeadline } from "./antigravity-acp";
import type { AntigravityError, AntigravityHistoryItem, AntigravityOption, AntigravityThread, AntigravityTool } from "./antigravity-types";
import { writePrivateFileAtomicSync } from "./atomic-file";

type StoredThread = Omit<AntigravityThread, "permissions"> & { cwd: string; remoteId?: string };
type PendingPermission = { choose: (allow?: boolean) => void };
type Agent = ReturnType<typeof launchAntigravity>;

const LOCK_OPTIONS = { stale: 20_000 };
const MAX_WORKERS = 4;
const MAX_PROMPT = 16_000;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

declare global {
  var __mompAntigravityWorkers: Map<string, AntigravityWorker> | undefined;
}
const workers = globalThis.__mompAntigravityWorkers ??= new Map<string, AntigravityWorker>();

export function hasActiveAntigravityTurns() {
  return [...workers.values()].some((worker) => ["connecting", "running", "stopping"].includes(worker.snapshot().status));
}

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function readOptions(value: unknown): AntigravityOption[] {
  return asArray(value).slice(0, 12).flatMap((entry) => {
    const config = asObject(entry);
    if (config.type !== "select") return [];
    const id = asText(config.id, 128);
    const name = asText(config.name, 120);
    const currentValue = asText(config.currentValue, 160);
    const selector = config.category ?? id;
    if (!id || !name || !["model", "thought_level", "thinking_level", "thinkingLevel", "model_config", "effort"].includes(String(selector))) return [];
    const choices = asArray(config.options).slice(0, 200).flatMap((choice) => {
      const group = asObject(choice);
      return Array.isArray(group.options) ? group.options.slice(0, 200) : [choice];
    }).slice(0, 200).flatMap((choice) => {
      const entry = asObject(choice);
      const value = asText(entry.value, 160);
      const name = asText(entry.name, 120);
      return value && name ? [{ value, name }] : [];
    });
    return choices.length ? [{ id, name, value: currentValue, choices }] : [];
  });
}

function publicThread(thread: StoredThread): AntigravityThread {
  const { id, title, revision, status, error, messages, options, tools, plan, context, stopReason } = thread;
  return { id, title, revision, status, error, messages, options, tools, permissions: [], plan, context, stopReason };
}

class AntigravityWorker {
  private agent?: Agent;
  private readonly pending = new Map<string, PendingPermission & AntigravityThread["permissions"][number]>();
  private idle?: ReturnType<typeof setTimeout>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private cancelTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private configuring = false;
  private lastChunk?: { role: "assistant" | "thinking"; upstreamId?: string };

  constructor(private readonly path: string, private readonly thread: StoredThread, private readonly release: () => void) {}

  snapshot(): AntigravityThread {
    return { ...publicThread(this.thread), permissions: [...this.pending.values()].map(({ id, title, canAllow }) => ({ id, title, canAllow })) };
  }

  private checkpoint(defer = false) {
    this.thread.revision = Math.max(Date.now(), this.thread.revision + 1);
    const flush = () => {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      writePrivateFileAtomicSync(this.path, JSON.stringify(this.thread));
    };
    if (!defer) return flush();
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      try { flush(); } catch { this.dispose("unavailable"); }
    }, 400);
    this.persistTimer.unref();
  }

  private expireWhenIdle() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.dispose(), 10 * 60_000);
    this.idle.unref();
  }

  async connect(executable: string, launch: typeof launchAntigravity) {
    try {
      this.thread.status = "connecting";
      this.thread.error = undefined;
      this.checkpoint();
      const agent = launch(executable, this.thread.cwd, {
        sessionUpdate: (event) => this.update(event),
        requestPermission: (request, options) => this.requestPermission(request, options?.signal),
      });
      this.agent = agent;
      void agent.closed.then(() => this.dispose(this.thread.status === "ready" ? "unavailable" : "interrupted"), () => this.dispose("unavailable"));
      const info = await agent.initialize();
      const setup = { cwd: this.thread.cwd, mcpServers: [] };
      const remoteId = this.thread.remoteId;
      if (remoteId) {
        const capability = asObject(info.agentCapabilities?.sessionCapabilities);
        const params = { ...setup, sessionId: remoteId };
        if (capability.resume) {
          const result = await withAcpDeadline(agent.connection.resumeSession(params), 30_000);
          if (result.configOptions) this.thread.options = readOptions(result.configOptions);
        } else if (info.agentCapabilities?.loadSession) {
          // The app persisted the transcript already. A history replay restores
          // the agent's context and configuration without duplicating the UI.
          const result = await withAcpDeadline(agent.connection.loadSession(params), 30_000);
          if (result.configOptions) this.thread.options = readOptions(result.configOptions);
        } else {
          throw new AntigravityFailure("unsupported");
        }
      } else {
        const result = await withAcpDeadline(agent.connection.newSession(setup), 30_000);
        if (!asText(result.sessionId, 512) || result.sessionId.length > 512) throw new AntigravityFailure("unavailable");
        this.thread.remoteId = result.sessionId;
        this.thread.options = readOptions(result.configOptions);
      }
      if (this.disposed) return;
      this.thread.status = "ready";
      this.checkpoint();
      this.expireWhenIdle();
    } catch (error) {
      this.dispose(antigravityError(error));
    }
  }

  async setOption(id: string, value: string) {
    const remoteId = this.requireReady();
    if (!this.thread.options.some((option) => option.id === id && option.choices.some((choice) => choice.value === value))) {
      throw new AntigravityFailure("unsupported");
    }
    this.configuring = true;
    try {
      const result = await withAcpDeadline(this.agent!.connection.setSessionConfigOption({ sessionId: remoteId, configId: id, value }), 12_000);
      if (this.disposed) throw new AntigravityFailure("unavailable");
      this.thread.options = readOptions(result.configOptions);
      this.checkpoint();
      this.expireWhenIdle();
    } catch (error) {
      if (antigravityError(error) === "timeout") this.dispose("timeout");
      throw error;
    } finally { this.configuring = false; }
  }

  send(text: string) {
    const remoteId = this.requireReady();
    if (!text || text.length > MAX_PROMPT) throw new AntigravityFailure("unsupported");
    this.thread.status = "running";
    this.thread.error = undefined;
    this.thread.stopReason = undefined;
    this.thread.tools = [];
    this.thread.plan = undefined;
    if (this.thread.messages.length === 0) this.thread.title = text.split("\n", 1)[0].slice(0, 100);
    this.thread.messages.push({ id: randomUUID(), role: "user", text });
    this.trimMessages();
    this.lastChunk = undefined;
    clearTimeout(this.idle);
    try {
      this.checkpoint();
    } catch (error) {
      this.dispose("unavailable");
      throw error;
    }
    void withAcpDeadline(this.agent!.connection.prompt({ sessionId: remoteId, prompt: [{ type: "text", text }] }), 10 * 60_000)
      .then((response) => {
        this.thread.stopReason = asText(response.stopReason, 80);
        this.finishTurn();
      })
      .catch((error) => {
        const kind = antigravityError(error);
        if (kind === "timeout" || kind === "auth-required" || this.agent?.connection.signal.aborted) this.dispose(kind);
        else this.finishTurn(kind);
      });
  }

  private requireReady(): string {
    if (this.thread.status !== "ready" || !this.thread.remoteId || !this.agent || this.configuring) throw new AntigravityFailure("unavailable");
    return this.thread.remoteId;
  }

  private finishTurn(error?: AntigravityError) {
    if (this.disposed) return;
    const cancelled = this.thread.status === "stopping" || this.thread.stopReason === "cancelled";
    clearTimeout(this.cancelTimer);
    this.clearPermissions();
    this.thread.status = "ready";
    this.thread.error = cancelled ? "cancelled" : error;
    this.checkpoint();
    this.expireWhenIdle();
  }

  cancel() {
    if (this.thread.status === "connecting") return this.dispose("cancelled");
    if (this.thread.status !== "running" || !this.thread.remoteId || !this.agent) return;
    this.thread.status = "stopping";
    this.clearPermissions();
    this.checkpoint();
    void this.agent.connection.cancel({ sessionId: this.thread.remoteId }).catch(() => this.dispose("cancelled"));
    this.cancelTimer = setTimeout(() => this.dispose("cancelled"), 6_000);
    this.cancelTimer.unref();
  }

  disconnect() { this.dispose(this.thread.status === "ready" ? undefined : "interrupted"); }

  private clearPermissions() { for (const permission of this.pending.values()) permission.choose(); }

  decide(id: string, allow: boolean) {
    const permission = this.pending.get(id);
    if (!permission || (allow && !permission.canAllow)) throw new AntigravityFailure("unavailable");
    permission.choose(allow);
  }

  private requestPermission(request: RequestPermissionRequest, signal?: AbortSignal): Promise<RequestPermissionResponse> {
    const cancelled = { outcome: { outcome: "cancelled" as const } };
    if (!request || request.sessionId !== this.thread.remoteId || this.thread.status !== "running" || this.pending.size >= 8 || signal?.aborted) {
      return Promise.resolve(cancelled);
    }
    const id = randomUUID();
    const title = asText(request.toolCall?.title, 500);
    const options = asArray(request.options).map(asObject);
    const allowId = asText(options.find(({ kind }) => kind === "allow_once")?.optionId, 180);
    const denyId = asText(options.find(({ kind }) => kind === "reject_once")?.optionId, 180);
    return new Promise((resolve) => {
      const abort = () => choose();
      const choose = (allow?: boolean) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        const optionId = allow === true && title ? allowId : allow === false ? denyId : "";
        resolve(optionId ? { outcome: { outcome: "selected", optionId } } : cancelled);
        this.checkpoint(true);
      };
      const timer = setTimeout(abort, 90_000);
      timer.unref();
      this.pending.set(id, { id, title, canAllow: Boolean(allowId && title), choose });
      signal?.addEventListener("abort", abort, { once: true });
      this.checkpoint(true);
    });
  }

  private trimMessages() {
    let size = 0;
    const messages = this.thread.messages;
    let index = messages.length;
    while (index > 0 && messages.length - index < 100 && (size += messages[index - 1].text.length) <= 210_000) index--;
    if (index) messages.splice(0, index);
  }

  private update(event: SessionNotification) {
    if (this.disposed || !event?.update || (this.thread.remoteId && event.sessionId !== this.thread.remoteId)) return;
    const { update } = event;
    if (update.sessionUpdate === "config_option_update") {
      this.thread.options = readOptions(update.configOptions);
    } else if (update.sessionUpdate === "session_info_update") {
      this.thread.title = asText(update.title, 120).trim() || this.thread.title;
    } else if (update.sessionUpdate === "usage_update" && Number.isSafeInteger(update.used) && Number.isSafeInteger(update.size) && update.used >= 0 && update.size > 0) {
      this.thread.context = { used: update.used, size: update.size };
    } else if (this.thread.status !== "running" && this.thread.status !== "stopping") {
      return;
    } else if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
      if (update.content?.type !== "text") return;
      const text = asText(update.content.text, 64_000);
      const role = update.sessionUpdate === "agent_message_chunk" ? "assistant" : "thinking";
      const upstreamId = update.messageId;
      const current = this.thread.messages.at(-1);
      if (current?.role === role && this.lastChunk?.role === role && this.lastChunk.upstreamId === upstreamId) {
        current.text = (current.text + text).slice(0, 64_000);
      } else {
        this.thread.messages.push({ id: randomUUID(), role, text });
        this.lastChunk = { role, upstreamId };
      }
      this.trimMessages();
    } else if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const id = asText(update.toolCallId, 180);
      if (!id) return;
      const prior = this.thread.tools.find((tool) => tool.id === id);
      const tool: AntigravityTool = prior ?? { id, title: "" };
      tool.title = asText(update.title, 500) || tool.title;
      tool.status = asText(update.status, 80) || tool.status;
      if (Array.isArray(update.content)) {
        const items = update.content.slice(0, 8);
        const output = items.flatMap((item) => item?.type === "content" && item.content?.type === "text" ? [asText(item.content.text, 3000)] : []).join("\n");
        const changes = items.flatMap((item) => item?.type === "diff" ? [{ path: asText(item.path, 400), before: asText(item.oldText, 3000), after: asText(item.newText, 3000) }] : []);
        if (output) tool.output = output.slice(0, 3500);
        if (changes.length) tool.changes = changes.slice(0, 3);
      }
      if (!prior) this.thread.tools = [...this.thread.tools.slice(-19), tool];
    } else if (update.sessionUpdate === "plan") {
      this.thread.plan = asArray(update.entries).slice(0, 20).map(asObject)
        .map((entry) => ({ text: asText(entry.content, 400), status: asText(entry.status, 80) }));
    } else return;
    this.checkpoint(true);
  }

  dispose(error?: AntigravityError, release = true) {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.cancelTimer);
    clearTimeout(this.idle);
    this.clearPermissions();
    clearTimeout(this.persistTimer);
    workers.delete(this.path);
    this.agent?.stop();
    this.thread.status = "offline";
    this.thread.error = error;
    if (release) {
      try { this.checkpoint(); } catch { /* Recover the last durable snapshot on reconnect. */ }
      try { this.release(); } catch { /* The lease may already have expired. */ }
    }
  }
}

export class AntigravitySessions {
  constructor(private readonly dir: string, private readonly launch = launchAntigravity) {}

  private path(id: string) {
    if (!ID.test(id)) throw new AntigravityFailure("unavailable");
    return join(this.dir, `${id}.json`);
  }

  private load(cwd: string, id: string): StoredThread | undefined {
    try {
      const thread = JSON.parse(readFileSync(this.path(id), "utf8")) as StoredThread;
      return thread.cwd === cwd ? thread : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  get(cwd: string, id: string): AntigravityThread | undefined {
    const path = this.path(id);
    const stored = this.load(cwd, id);
    if (!stored) return undefined;
    const worker = workers.get(path);
    if (worker) return worker.snapshot();
    if (stored.status !== "offline" && !checkSync(path, LOCK_OPTIONS)) {
      if (stored.status !== "ready") stored.error = "interrupted";
      stored.status = "offline";
    }
    return publicThread(stored);
  }

  history(cwd: string): AntigravityHistoryItem[] {
    let files: string[];
    try { files = readdirSync(this.dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return files.filter((name) => name.endsWith(".json") && ID.test(name.slice(0, -5)))
      .flatMap((file) => {
        const thread = this.get(cwd, file.slice(0, -5));
        if (!thread) return [];
        const { id, title, revision, status } = thread;
        return [{ id, title, revision, status }];
      }).sort((a, b) => b.revision - a.revision).slice(0, 60);
  }

  open(cwd: string, executable: string, id?: string): AntigravityThread {
    const thread = id ? this.load(cwd, id) : {
      id: randomUUID(), cwd, title: "", revision: Date.now(), status: "offline" as const, messages: [], options: [], tools: [],
    };
    if (!thread) throw new AntigravityFailure("unavailable");
    const path = this.path(thread.id);
    const current = workers.get(path);
    if (current) return current.snapshot();
    if (workers.size >= MAX_WORKERS) throw new AntigravityFailure("unavailable");
    if (!id) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writePrivateFileAtomicSync(path, JSON.stringify(thread));
    }
    const release = lockSync(path, { ...LOCK_OPTIONS, onCompromised: () => worker.dispose("interrupted", false) });
    const worker = new AntigravityWorker(path, thread, release);
    workers.set(path, worker);
    void worker.connect(executable, this.launch);
    return worker.snapshot();
  }

  active(cwd: string, id: string) {
    const worker = this.load(cwd, id) && workers.get(this.path(id));
    if (!worker) throw new AntigravityFailure("unavailable");
    return worker;
  }
}
