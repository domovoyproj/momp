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
    return "Каждый запрос требует пароль из переменной MOMP_WEB_PASSWORD (или OMP_WEB_PASSWORD).";
  }
  if (status.unreadable) {
    return "Файл учетных данных существует, но не может быть прочитан. Запросы отклоняются.";
  }
  if (!status.configured) return "Пароль не установлен. Любой пользователь в сети может открыть веб-интерфейс.";
  return status.enabled
    ? "Каждый запрос требует имя пользователя и пароль."
    : "Пароль сохранен, но защита паролем отключена.";
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
    return <div className={styles.empty}>{loadError ?? "Загрузка настроек доступа…"}</div>;
  }

  const readOnly = status.managedByEnvironment;
  const canSave = !busy && !readOnly && password.length >= MIN_PASSWORD_LENGTH && password === confirmation;

  return (
    <div className={styles.scrollContent}>
      <header className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>Защита доступа</h2>
        <p className={styles.contentDescription}>
          Пароль блокирует веб-интерфейс и все API-эндпоинты через HTTP Basic Auth со стандартным
          именем пользователя <code>{status.username}</code>. Пароль хранится в виде scrypt-хэша в <code>{status.file}</code> —
          momp-web не сохраняет пароль в открытом виде.
        </p>
        {readOnly && (
          <div className={styles.readOnlyNotice}>
            Только чтение · Переменная <code>MOMP_WEB_PASSWORD</code> активна и переопределяет сохраненный пароль.
          </div>
        )}
        {notice && (
          <div className={styles.reloadNotice}><span>{notice}</span></div>
        )}
      </header>
      <div className={styles.settingsBody}>
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Защита паролем</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Требовать пароль</div>
              <div className={styles.settingDescription}>{describeState(status)}</div>
              {!status.configured && !readOnly && (
                <div className={styles.settingDescription}>Установите пароль ниже перед включением.</div>
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
          <h3 className={styles.groupTitle}>{status.stored ? "Сменить пароль" : "Установить пароль"}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Новый пароль</div>
              <div className={styles.settingDescription}>
                Минимум {MIN_PASSWORD_LENGTH} символов. Сохранение пароля также активирует защиту.
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
              <div className={styles.settingLabel}>Подтверждение пароля</div>
              <div className={styles.settingDescription}>Оба поля должны совпадать.</div>
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
                  ? `Изменен ${new Date(status.updatedAt).toLocaleString("ru-RU")}`
                  : "Пароль еще не установлен"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {status.stored && !readOnly && (
                <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void clearPassword()}>
                  Удалить пароль
                </button>
              )}
              <button type="button" className={styles.primaryButton} disabled={!canSave} onClick={() => void savePassword()}>
                {busy ? "Сохранение…" : "Сохранить пароль"}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Восстановление доступа</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Восстановление пароля</div>
              <div className={styles.settingDescription}>
                Выполните команду <code>momp-web --reset-password</code> на сервере или откройте страницу <code>/recover</code> в браузере.
                Сервер выведет одноразовый проверочный код в терминал, ввод которого позволит задать новый пароль.
              </div>
            </div>
            <div className={styles.settingControl}>
              <a className={styles.linkButton} href="/recover" target="_blank" rel="noreferrer">Открыть /recover</a>
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Безопасность Basic Auth</div>
              <div className={styles.settingDescription}>
                При работе в публичной или недоверенной сети рекомендуется использовать HTTPS или VPN перед открытием доступа наружу.
              </div>
            </div>
            <div className={styles.settingControl} />
          </div>
        </section>
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Системные уведомления</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>Уведомления браузера</div>
              <div className={styles.settingDescription}>
                Отправлять нативное системное уведомление Windows/macOS, когда агент закончил генерацию ответа, а вкладка находится в фоне.
              </div>
            </div>
            <div className={styles.settingControl}>
              <button
                type="button"
                className={styles.linkButton}
                style={{ cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)" }}
                onClick={async () => {
                  if (!("Notification" in window)) {
                    alert("Уведомления не поддерживаются в этом браузере.");
                    return;
                  }
                  const perm = await Notification.requestPermission();
                  if (perm === "granted") {
                    new Notification("momp max", {
                      body: "Уведомления успешно включены и работают!",
                    });
                  } else {
                    alert("Разрешение на отправку уведомлений заблокировано в настройках браузера.");
                  }
                }}
              >
                {typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted"
                  ? "✓ Уведомления разрешены (Проверить)"
                  : "Включить уведомления"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
