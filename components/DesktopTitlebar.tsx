"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

type DesktopWindow = {
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  startDragging(): Promise<void>;
  setDecorations(value: boolean): Promise<void>;
};

function getDesktopWindow(): DesktopWindow | undefined {
  return (globalThis as typeof globalThis & {
    __TAURI__?: { window?: { getCurrentWindow(): DesktopWindow } };
  }).__TAURI__?.window?.getCurrentWindow();
}

export function DesktopTitlebar() {
  const { t } = useI18n();
  const [desktop, setDesktop] = useState<DesktopWindow>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const current = getDesktopWindow();
    if (!current) return;
    let active = true;
    current.setDecorations(false).then(() => {
      if (!active) return;
      document.documentElement.dataset.desktop = "true";
      setDesktop(current);
    }).catch(() => {});
    return () => {
      active = false;
      delete document.documentElement.dataset.desktop;
      void current.setDecorations(true).catch(() => {});
    };
  }, []);

  if (!desktop) return null;
  const run = (action: () => Promise<void>) => {
    setError(false);
    void action().catch(() => setError(true));
  };
  return (
    <div className="desktop-titlebar">
      <div className="window-controls" aria-label={t("desktop.controls")}>
        <button className="window-control window-close" aria-label={t("desktop.close")} title={t("desktop.close")} onClick={() => run(() => desktop.close())}>×</button>
        <button className="window-control window-minimize" aria-label={t("desktop.minimize")} title={t("desktop.minimize")} onClick={() => run(() => desktop.minimize())}>−</button>
        <button className="window-control window-maximize" aria-label={t("desktop.maximize")} title={t("desktop.maximize")} onClick={() => run(() => desktop.toggleMaximize())}>↗</button>
      </div>
      <div className="window-drag-region" onMouseDown={(event) => {
        if (event.button === 0 && event.detail === 1) run(() => desktop.startDragging());
      }} onDoubleClick={() => run(() => desktop.toggleMaximize())}>momp</div>
      {error && <span role="alert" className="window-error">{t("desktop.error")}</span>}
    </div>
  );
}
