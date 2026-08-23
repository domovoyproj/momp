"use client";

import { useCallback, useEffect, useState } from "react";
import type { WebAccessStatus } from "@/lib/api-types";
import styles from "./SettingsConfig.module.css";

/**
 * The password lock, from the settings dialog.
 *
 * omp-web can drive a high-privilege agent, so the panel is deliberately blunt
 * about what the lock does and does not protect: it authenticates, it does not
 * encrypt, and the password itself is never readable back — which is why the
 * recovery paths are spelled out here rather than left to the documentation.
 */

type AccessAction = "set-password" | "enable" | "disable" | "clear";

const MIN_PASSWORD_LENGTH = 8;

function describeState(status: WebAccessStatus): string {
  if (status.managedByEnvironment) {
    return "Every request needs the password from OMP_WEB_PASSWORD.";
  }
  if (status.unreadable) {
    return "The credential file exists but could not be read, so every request is being refused.";
  }
  if (!status.configured) return "No password is set. Anyone who can reach this server can use it.";
  return status.enabled
    ? "Every request needs the username and password."
    : "A password is stored but the lock is off.";
}

export function AccessConfig() {
  const [status, setStatus] = useState<WebAccessStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/web-access", { cache: "no-store" });
      const data = await response.json() as WebAccessStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (action: AccessAction, body: { password?: string } = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/web-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json() as WebAccessStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setStatus(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const savePassword = useCallback(async () => {
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    const updated = await send("set-password", { password });
    if (!updated) return;
    setPassword("");
    setConfirmation("");
    setNotice(
      `Password saved and password access turned on. The browser will ask for the username "${updated.username}"`
      + " and this password on the next request.",
    );
  }, [confirmation, password, send]);

  const toggleEnabled = useCallback(async () => {
    if (!status) return;
    const updated = await send(status.enabled ? "disable" : "enable");
    if (!updated) return;
    setNotice(updated.enabled
      ? `Password access is on. The browser will ask for the username "${updated.username}" and your password on the next request.`
      : "Password access is off. The stored password is kept and can be switched back on here.");
  }, [send, status]);

  const clearPassword = useCallback(async () => {
    const updated = await send("clear");
    if (!updated) return;
    setNotice("The stored password was removed and password access is off.");
  }, [send]);

  if (!status) {
    return <div className={styles.empty}>{loadError ?? "Loading password access…"}</div>;
  }

  const readOnly = status.managedByEnvironment;
  const canSave = !busy && !readOnly && password.length >= MIN_PASSWORD_LENGTH && password === confirmation;

  return (
    <div className={styles.scrollContent}>
      <header className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>Access</h2>
        <p className={styles.contentDescription}>
          A password locks the web interface and every API endpoint behind HTTP Basic Auth, with the fixed
          username <code>{status.username}</code>. It is stored as a scrypt hash in <code>{status.file}</code> —
          omp-web never keeps the password itself, which is why forgetting it means recovering rather than reading it back.
        </p>
        {readOnly && (
          <div className={styles.readOnlyNotice}>
            Read-only · <code>OMP_WEB_PASSWORD</code> is set and overrides the stored credential. Unset it and restart
            omp-web to manage the password here.
          </div>
        )}
        {notice && (
          <div className={styles.reloadNotice}><span>{notice}</span></div>
        )}
      </header>

      <div className={styles.settingsBody}>
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Password access</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Require a password</div>
              <div className={styles.settingDescription}>{describeState(status)}</div>
              {!status.configured && !readOnly && (
                <div className={styles.settingDescription}>Set a password below before turning this on.</div>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.settingControl}>
              <button
                type="button"
                className={styles.switch}
                data-on={status.enabled}
                aria-pressed={status.enabled}
                aria-label="Require a password"
                disabled={busy || readOnly || (!status.enabled && !status.stored)}
                onClick={() => void toggleEnabled()}
              />
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{status.stored ? "Replace the password" : "Set a password"}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>New password</div>
              <div className={styles.settingDescription}>
                At least {MIN_PASSWORD_LENGTH} characters. Saving a password also turns password access on.
              </div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy || readOnly}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Confirm password</div>
              <div className={styles.settingDescription}>Both entries have to match before it can be saved.</div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy || readOnly}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSave) void savePassword(); }}
              />
            </div>
          </div>
          <div className={styles.editorActions}>
            <div>
              <div className={styles.saveState}>
                {status.stored && status.updatedAt
                  ? `Last changed ${new Date(status.updatedAt).toLocaleString()}`
                  : "No password stored yet"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {status.stored && !readOnly && (
                <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void clearPassword()}>
                  Remove password
                </button>
              )}
              <button type="button" className={styles.primaryButton} disabled={!canSave} onClick={() => void savePassword()}>
                {busy ? "Saving…" : "Save password"}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>If you forget it</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Recovery</div>
              <div className={styles.settingDescription}>
                Run <code>omp-web --reset-password</code> on this machine to set a new one, or open <code>/recover</code> in
                the browser: omp-web prints a one-time code on its own console, and entering that code sets a new password.
                Both paths require access to the machine running the server — nothing can hand the password back.
              </div>
            </div>
            <div className={styles.settingControl}>
              <a className={styles.linkButton} href="/recover" target="_blank" rel="noreferrer">Open /recover</a>
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Basic Auth is not encryption</div>
              <div className={styles.settingDescription}>
                The password crosses the network in a reversible encoding. Over plain HTTP on an untrusted network it can be
                read in transit, so put omp-web behind HTTPS or a trusted VPN before exposing it beyond loopback.
              </div>
            </div>
            <div className={styles.settingControl} />
          </div>
        </section>
      </div>
    </div>
  );
}
