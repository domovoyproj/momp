"use client";

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaInstallState {
  canInstall: boolean;
  isStandalone: boolean;
  isIos: boolean;
  install: () => Promise<boolean>;
}

export function usePwaInstall(): PwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // In native desktop shell (Tauri), PWA install is not applicable
    const isTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined;
    if (isTauri) {
      setIsStandalone(true);
      return;
    }

    // Detect if already installed and running standalone
    const standaloneMedia = window.matchMedia("(display-mode: standalone)");
    const isStandaloneMode =
      standaloneMedia.matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    const onMediaChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
    };
    standaloneMedia.addEventListener("change", onMediaChange);

    // iOS Safari does not support beforeinstallprompt, but supports Add to Home Screen
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIos(isIosDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      standaloneMedia.removeEventListener("change", onMediaChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
        setIsInstalled(true);
        return true;
      }
    } catch (err) {
      console.error("Failed to prompt PWA install:", err);
    }
    return false;
  }, [deferredPrompt]);

  const canInstall = !isStandalone && !isInstalled && (deferredPrompt !== null || isIos);

  return {
    canInstall,
    isStandalone,
    isIos,
    install,
  };
}
