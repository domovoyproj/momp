"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { OmpWebUpdateResponse } from "@/lib/api-types";
import { MarkdownBody } from "./MarkdownBody";

import { WorkspaceIcon } from "./WorkspaceIcon";

function displayVersion(version: string): string {
  return version === "unknown" ? version : `v${version}`;
}

/**
 * Opens a URL in the OS browser. Inside the Tauri desktop shell
 * (`withGlobalTauri`), routes through the opener plugin; otherwise falls back
 * to a plain new-tab open. Narrows `window.__TAURI__` at runtime — the desktop
 * bridge is injected, never typed.
 */
async function openExternalUrl(url: string): Promise<void> {
  const fallback = () => { window.open(url, "_blank", "noreferrer"); };
  const w: unknown = typeof window !== "undefined" ? window : undefined;
  if (!w || typeof w !== "object" || !("__TAURI__" in w)) return fallback();
  const tauri = w.__TAURI__;
  if (!tauri || typeof tauri !== "object") return fallback();
  try {
    if ("opener" in tauri && tauri.opener && typeof tauri.opener === "object" && "openUrl" in tauri.opener) {
      const openUrl = tauri.opener.openUrl;
      if (typeof openUrl === "function") { await openUrl(url); return; }
    }
    if ("core" in tauri && tauri.core && typeof tauri.core === "object" && "invoke" in tauri.core) {
      const invoke = tauri.core.invoke;
      if (typeof invoke === "function") { await invoke("plugin:opener|open_url", { url }); return; }
    }
  } catch {
    /* fall through to browser open */
  }
  fallback();
}

export function OmpUpdateIndicator() {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<OmpWebUpdateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [copied, setCopied] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const loadStatus = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
      const response = await fetch("/api/updates", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Update check failed");
      const data = await response.json() as OmpWebUpdateResponse;
      setStatus(data);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const onVisible = () => { if (!document.hidden) void loadStatus(); };
    const timer = setInterval(onVisible, 30 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      request.current?.abort();
      request.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadStatus]);

  useEffect(() => {
    if (!open) return;
    const panel = dialog.current!;
    panel.showModal();
    return () => panel.close();
  }, [open]);

  const release = status?.latestRelease;
  const checked = status?.checkedAt;
  const checkedAt = checked && Number.isFinite(Date.parse(checked)) ? new Date(checked) : undefined;

  async function copyCommand(command: string) {
    try { await copyText(command); setCopied(command); }
    catch { setMessage({ kind: "error", text: t("updates.copyFailed") }); }
  }

  async function installUpdate() {
    if (installing || !status?.updateAvailable || !status.install.canInstall || !release) return;
    setInstalling(true);
    setMessage(undefined);
    try {
      const activity = await fetch("/api/workspace-activity", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!activity.ok || (await activity.json()).busy !== false) throw new Error(t("updates.workspaceBusy"));
      if (status.desktop) {
        const bridge = (window as unknown as { __TAURI__?: { core?: { invoke?: (command: string) => Promise<void> } } }).__TAURI__;
        if (!bridge?.core?.invoke) throw new Error(t("updates.bridgeUnavailable"));
        await bridge.core.invoke("install_desktop_update");
        setMessage({ kind: "success", text: t("updates.restarting") });
      } else {
        const response = await fetch("/api/updates", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const result = await response.json().catch(() => ({})) as { error?: string; installedVersion?: string };
        if (!response.ok) throw new Error(result.error ?? t("updates.installFailed"));
        setMessage({ kind: "success", text: t("updates.installed", { version: displayVersion(result.installedVersion ?? release.version) }) });
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setInstalling(false); }
  }

  return <>
    <button type="button" className="update-center-trigger" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setOpen(true); setMessage(undefined); setCopied(undefined); }}>
      <WorkspaceIcon name="release" size={17} />
      <span>{t("updates.center")}</span>
      {status?.updateAvailable && release && <small>{displayVersion(release.version)}</small>}
    </button>
    {open && <dialog ref={dialog} className="workbench-dialog update-center" aria-labelledby="updates-title"
      onCancel={(event) => { event.preventDefault(); if (!installing) setOpen(false); }}>
      <header className="workbench-dialog-header">
        <h2 id="updates-title">{t("updates.center")}</h2>
        <div className="usage-actions">
          <button type="button" disabled={loading || installing} onClick={() => void loadStatus()}>{t(loading ? "updates.checking" : "updates.checkNow")}</button>
          <button type="button" aria-label={t("collaboration.close")} disabled={installing} onClick={() => setOpen(false)}>×</button>
        </div>
      </header>
      <div className="workbench-dialog-body update-center-content">
        {status && <div className="update-versions">
          <p><span>{t("updates.installedVersion")}</span><strong>{displayVersion(status.currentAppVersion)}</strong></p>
          <p><span>{t("updates.stableVersion")}</span><strong>{displayVersion(status.latestRelease.version)}</strong></p>
        </div>}
        {error ? <p role="alert" className="workbench-error">{t("updates.checkFailed")}</p>
          : status && <p role="status">{t(status.updateAvailable ? "updates.available" : "updates.currentVersion")}</p>}
        {checkedAt && <p className="usage-meta">{t("updates.checkedAt")} <time dateTime={checkedAt.toISOString()}>{checkedAt.toLocaleString(locale)}</time></p>}
        {status?.updateAvailable && release && <>
          <section className="update-notes">
            <h3>{t("updates.changelog")}</h3>
            <MarkdownBody>{release.body.trim() || release.name}</MarkdownBody>
          </section>
          <div className="update-actions">
            <a href={release.htmlUrl} onClick={(event) => { event.preventDefault(); void openExternalUrl(release.htmlUrl); }} target="_blank" rel="noreferrer">{t("updates.viewRelease")}</a>
            {status.install.canInstall && <button type="button" className="workbench-primary" disabled={installing}
              onClick={() => void installUpdate()}>{t(installing ? "updates.installing" : status.desktop ? "updates.installRestart" : "updates.install")}</button>}
          </div>
          {!status.install.canInstall && !status.desktop && <section className="update-notes">
            <p>{t("updates.manual")}</p>
            {[status.install.command, status.install.alternateCommand].map((command) => <div key={command} className="update-command">
              <code>{command}</code>
              <button type="button" onClick={() => void copyCommand(command)}>{t(copied === command ? "updates.commandCopied" : "updates.copyCommand")}</button>
            </div>)}
          </section>}
        </>}
        {status && <details className="update-rollback">
          <summary>{t("updates.rollbackTitle")}</summary>
          <p>{t(status.desktop ? "updates.desktopRollback" : "updates.webRollback")}</p>
        </details>}
        {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "workbench-error" : undefined}>{message.text}</p>}
      </div>
    </dialog>}
  </>;
}
