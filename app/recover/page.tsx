"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import styles from "./recover.module.css";

/**
 * Password recovery, reachable without credentials.
 *
 * The page cannot let anyone in on its own. Asking for a code makes the server
 * print one on its own console — the terminal omp-web is running in — so
 * completing the flow proves the person driving it can see that machine. See
 * `app/api/web-access/recovery/route.ts`.
 */

const MIN_PASSWORD_LENGTH = 8;

type Stage = "idle" | "code-sent" | "done";

export default function RecoverPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/web-access/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as { ok?: boolean; expiresAt?: number; error?: string };
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }, []);

  const requestCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await post({ action: "request" });
      setExpiresAt(data.expiresAt ?? null);
      setStage("code-sent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [post]);

  const completeRecovery = useCallback(async () => {
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post({ action: "complete", code, password });
      setCode("");
      setPassword("");
      setConfirmation("");
      setStage("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [code, confirmation, password, post]);

  const canSubmit = !busy
    && code.trim().length > 0
    && password.length >= MIN_PASSWORD_LENGTH
    && password === confirmation;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>omp-web</div>
        <h1 className={styles.title}>Recover access</h1>

        {stage === "done" ? (
          <>
            <p className={styles.lead}>
              The password was changed and password access is on. Open omp-web and sign in with the
              username <code>omp</code> and your new password.
            </p>
            <Link className={styles.primary} href="/">Back to omp-web</Link>
          </>
        ) : (
          <>
            <p className={styles.lead}>
              omp-web stores your password as a hash and cannot read it back. To set a new one, it prints a one-time
              recovery code <strong>on its own console</strong> — the terminal running omp-web. Read the code there
              and enter it below.
            </p>
            <p className={styles.aside}>
              No terminal at hand? Run <code>omp-web --reset-password</code> on that machine instead.
            </p>

            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void requestCode()}>
              {busy && stage === "idle" ? "Requesting…" : stage === "code-sent" ? "Send another code" : "Print a recovery code"}
            </button>

            {stage === "code-sent" && (
              <p className={styles.notice}>
                A code was printed on the server console
                {expiresAt ? ` and is valid until ${new Date(expiresAt).toLocaleTimeString()}` : ""}.
              </p>
            )}

            <label className={styles.field}>
              <span>Recovery code</span>
              <input
                className={styles.input}
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX"
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>New password</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>Confirm password</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSubmit) void completeRecovery(); }}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="button" className={styles.primary} disabled={!canSubmit} onClick={() => void completeRecovery()}>
              {busy && stage === "code-sent" ? "Setting…" : "Set new password"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
