import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (typeof process.versions.bun === "string") {
    // Windows desktop/web starts with the Google route already configured.
    // An explicit operator override remains available for diagnostics.
    // Some Windows launchers preserve a cleared variable as an empty string.
    // Only a nonempty value is an explicit operator override (notably "0").
    if (!process.env.MOMP_XBOX_DNS) process.env.MOMP_XBOX_DNS = process.platform === "win32" ? "1" : "0";
    if (process.env.MOMP_XBOX_DNS === "1") {
      const { installGoogleDnsFetch } = await import("@/lib/google-network");
      await installGoogleDnsFetch();
    }
    return;
  }

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  const importRuntimeModule = Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<DispatcherModule>;
  const moduleUrl = `file://${encodeURI(process.cwd())}/lib/http-dispatcher.ts`;
  const { configureHttpDispatcher } = await importRuntimeModule(moduleUrl);
  await configureHttpDispatcher();
}
