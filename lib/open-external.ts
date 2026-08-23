// In a Tauri desktop webview, window.open(url, "_blank") opens a new webview
// window instead of a system browser tab, which would silently break OAuth
// login. The desktop build exposes window.__TAURI__ (withGlobalTauri) and the
// opener plugin's `plugin:opener|open_url` IPC command; route through it when
// present, and fall back to the plain browser behavior everywhere else.
export function openExternal(url: string): void {
  const tauri = (
    globalThis as unknown as {
      __TAURI__?: {
        core: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
        }
      }
    }
  ).__TAURI__

  if (tauri) {
    tauri.core.invoke("plugin:opener|open_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer")
    })
    return
  }

  window.open(url, "_blank", "noopener,noreferrer")
}
