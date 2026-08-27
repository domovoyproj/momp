"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // The desktop shell (Tauri) runs a local server that the native launcher
    // waits on before navigating, so the PWA offline fallback only causes harm
    // there: a stale cached offline.html traps the window during startup.
    // Never register in desktop, and tear down any SW an older build left.
    const isDesktop =
      typeof window !== "undefined" &&
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined;
    if (isDesktop) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister();
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) void caches.delete(key);
        });
      }
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      return;
    }

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker
        .register(scriptUrl, { scope: "/", updateViaCache: "none" })
        .catch((error: unknown) => {
          console.error("Failed to register the momp-web service worker:", error);
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
