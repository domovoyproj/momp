"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AntigravityHistoryItem, AntigravityThread } from "@/lib/antigravity-types";
import { MarkdownBody } from "./MarkdownBody";
import { WorkspaceIcon } from "./WorkspaceIcon";

const INSTALL_URL = "https://antigravity.google/docs/cli/install";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "unavailable");
  return value;
}

export function AntigravityPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [history, setHistory] = useState<AntigravityHistoryItem[]>([]);
  const [thread, setThread] = useState<AntigravityThread>();
  const [project, setProject] = useState<{ configured: boolean; trusted: boolean }>();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const url = `/api/antigravity?${new URLSearchParams({ cwd })}`;
  const id = thread?.id;
  const active = thread && ["connecting", "running", "stopping"].includes(thread.status);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request<{ history: AntigravityHistoryItem[]; configured: boolean; trusted: boolean }>(url, { signal: controller.signal })
      .then(({ history, configured, trusted }) => { setHistory(history); setProject({ configured, trusted }); })
      .catch(() => { if (!controller.signal.aborted) setError("unavailable"); });
    return () => controller.abort();
  }, [url]);

  useEffect(() => {
    if (!id) return;
    const events = new EventSource(`${url}&id=${encodeURIComponent(id)}&events=1`);
    events.onerror = () => setReconnecting(true);
    events.onopen = () => setReconnecting(false);
    events.onmessage = (event) => {
      const next = JSON.parse(event.data) as AntigravityThread;
      setThread((previous) => previous?.id === id && next.revision >= previous.revision ? next : previous);
      setHistory((previous) => {
        const existing = previous.find((item) => item.id === id);
        if (existing && existing.title === next.title && existing.status === next.status) return previous;
        const { title, revision, status } = next;
        return [{ id, title, revision, status }, ...previous.filter((item) => item.id !== id)].slice(0, 60);
      });
    };
    return () => events.close();
  }, [id, url]);

  useEffect(() => {
    const viewport = scroll.current;
    if (viewport && following.current) viewport.scrollTop = viewport.scrollHeight;
  }, [thread?.revision]);

  async function loadThread(threadId: string) {
    setBusy("load");
    setError("");
    try {
      const value = await request<{ thread: AntigravityThread }>(`${url}&id=${encodeURIComponent(threadId)}`);
      following.current = true;
      setReconnecting(false);
      setThread(value.thread);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(undefined); }
  }

  async function act(action: string, args: Record<string, unknown> = {}) {
    setBusy(action);
    setError("");
    try {
      const value = await request<{ thread?: AntigravityThread }>(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, cwd, id, ...args }),
      });
      const next = value.thread;
      if (next) setThread((previous) => previous?.id === next.id && previous.revision > next.revision ? previous : next);
      if (action === "prompt") { following.current = true; setMessage(""); }
      if (action === "sign-in") setSignedIn(true);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(undefined); }
  }

  function newThread() {
    following.current = true;
    setThread(undefined);
    setError("");
    setReconnecting(false);
    setMessage("");
  }

  const connectionError = error || (signedIn && thread?.error === "auth-required" ? "" : thread?.error);
  const workspaceName = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  const matches = history.filter((item) => (item.title || t("antigravity.untitled")).toLowerCase().includes(query.toLowerCase()));

  return <dialog ref={dialog} className="workbench-dialog antigravity-dialog" aria-labelledby="antigravity-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="workbench-dialog-header antigravity-heading">
      <div className="antigravity-heading-label"><span className="antigravity-emblem"><WorkspaceIcon name="chat" size={19} /></span>
        <div><h2 id="antigravity-title">Google Antigravity</h2><p title={cwd}>{workspaceName}</p></div></div>
      <div className="antigravity-header-controls">
        <span className="antigravity-status" data-state={thread?.status ?? "offline"} role="status">
          {t(reconnecting ? "antigravity.reconnecting" : `antigravity.status.${thread?.status ?? "offline"}`)}
        </span>
        <button type="button" aria-label={t("collaboration.close")} onClick={onClose}>×</button>
      </div>
    </header>
    <div className="antigravity-layout">
      <aside className="antigravity-history" aria-label={t("antigravity.history")}>
        <div className="antigravity-history-actions">
          <button type="button" disabled={Boolean(busy)} onClick={newThread}>＋ {t("antigravity.new")}</button>
          <input type="search" value={query} aria-label={t("antigravity.search")} placeholder={t("antigravity.search")} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="antigravity-history-list">
          {matches.map((item) => <button key={item.id} type="button" disabled={Boolean(busy)} aria-current={id === item.id ? "true" : undefined}
            title={item.title} onClick={() => void loadThread(item.id)}>{item.title || t("antigravity.untitled")}</button>)}
          {!matches.length && <small>{t("antigravity.emptyHistory")}</small>}
        </div>
      </aside>
      <section className="antigravity-main" aria-label={t("antigravity.conversation")}>
        <div className="antigravity-transcript" ref={scroll} onScroll={(event) => {
          const el = event.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}>
          {connectionError && <p className="workbench-error" role="alert">{t(`antigravity.error.${connectionError}`)}</p>}
          {!thread?.messages.length && <div className="antigravity-intro">
            <h3>{t("antigravity.startTitle")}</h3>
            <p>{t("antigravity.intro")}</p>
          </div>}
          {thread?.messages.map((entry) => <div key={entry.id} className="antigravity-message" data-role={entry.role}>
            {entry.role === "thinking"
              ? <details><summary>{t("antigravity.thinking")}</summary><p>{entry.text}</p></details>
              : <><small>{entry.role === "user" ? t("antigravity.you") : "Gemini"}</small>
                {entry.role === "user" ? <p>{entry.text}</p> : <MarkdownBody isStreaming={Boolean(active)}>{entry.text}</MarkdownBody>}</>}
          </div>)}
          {thread?.plan?.length ? <section className="antigravity-activity"><h3>{t("antigravity.plan")}</h3>
            <ol>{thread.plan.map((entry, index) => <li key={index}><span>{entry.text}</span><small>{t(`antigravity.tool.${entry.status}`)}</small></li>)}</ol>
          </section> : null}
          {thread?.tools.length ? <section className="antigravity-activity"><h3>{t("antigravity.tools")}</h3>
            {thread.tools.map((tool) => <details key={tool.id} className="antigravity-tool">
              <summary><span>{tool.title || t("antigravity.tool.unknown")}</span>{tool.status && <small>{t(`antigravity.tool.${tool.status}`)}</small>}</summary>
              {tool.output && <pre tabIndex={0}>{tool.output}</pre>}
              {tool.changes?.map((change, index) => <div key={index} className="antigravity-change">
                <code>{change.path}</code><pre tabIndex={0} data-side="before">{change.before}</pre><pre tabIndex={0} data-side="after">{change.after}</pre>
              </div>)}
            </details>)}
          </section> : null}
          {thread?.stopReason && thread.stopReason !== "end_turn" && thread.stopReason !== "cancelled" &&
            <p className="antigravity-end-reason">{t(`antigravity.stop.${thread.stopReason}`)}</p>}
          {thread?.permissions.map((permission) => <section key={permission.id} className="antigravity-permission">
            <h3>{t("antigravity.permission")}</h3><p>{permission.title || t("antigravity.tool.unknown")}</p>
            <div><button type="button" disabled={Boolean(busy)} onClick={() => void act("permission", { permission: permission.id, allow: false })}>{t("antigravity.deny")}</button>
              <button type="button" disabled={Boolean(busy) || !permission.canAllow} onClick={() => void act("permission", { permission: permission.id, allow: true })}>{t("antigravity.allow")}</button></div>
          </section>)}
        </div>
        {thread?.status === "ready" || thread?.status === "running" || thread?.status === "stopping" ? <form className="antigravity-composer"
          onSubmit={(event) => { event.preventDefault(); if (!busy && !active && message.trim()) void act("prompt", { text: message }); }}>
          <textarea rows={3} maxLength={16000} aria-label={t("antigravity.message")} placeholder={t("antigravity.message")}
            value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          <div className="antigravity-composer-bar">
            {thread.options.map((option) => <label key={option.id}>{option.name}<select value={option.value} disabled={Boolean(active || busy)}
              onChange={(event) => void act("config", { key: option.id, value: event.target.value })}>
              {option.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.name}</option>)}
            </select></label>)}
            {thread.context && <small>{t("antigravity.context", { used: thread.context.used, size: thread.context.size })}</small>}
            <div className="antigravity-composer-actions">
              {active ? <button type="button" disabled={Boolean(busy) || thread.status === "stopping"} onClick={() => void act("cancel")}>{t("antigravity.cancel")}</button>
                : <><button type="button" disabled={Boolean(busy)} onClick={() => void act("disconnect")}>{t("antigravity.disconnect")}</button>
                  <button className="workbench-primary" type="submit" disabled={Boolean(busy) || !message.trim()}>{t("antigravity.send")}</button></>}
            </div>
          </div>
        </form> : <div className="antigravity-connect">
          {thread?.status === "connecting" ? <button type="button" disabled={Boolean(busy)} onClick={() => void act("cancel")}>{t("antigravity.cancel")}</button>
            : project?.configured ? <>
              {!project.trusted && <p className="workbench-error">{t("antigravity.error.trust")}</p>}
              <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{t("antigravity.consent")}</label>
              {signedIn && <p role="status">{t("antigravity.signedIn")}</p>}
              <div><button type="button" disabled={Boolean(busy)} onClick={() => void act("sign-in")}>
                {t(busy === "sign-in" ? "antigravity.signingIn" : "antigravity.signIn")}</button>
                <button className="workbench-primary" type="button" disabled={Boolean(busy) || !project.trusted || !consent}
                  onClick={() => { setSignedIn(false); void act("open", { confirm: true }); }}>{t(thread ? "antigravity.resume" : "antigravity.connect")}</button></div>
            </> : project && <><p>{t("antigravity.error.not-installed")}</p><a href={INSTALL_URL} target="_blank" rel="noreferrer">{t("connections.antigravitySetup")}</a></>}
        </div>}
      </section>
    </div>
  </dialog>;
}
