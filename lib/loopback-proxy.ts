/** Preserve user bypass rules and keep local providers out of the HTTP proxy. */
export function configureLoopbackProxyBypass(env: NodeJS.ProcessEnv = process.env): void {
  const bypass = new Set([
    ...(env.NO_PROXY ?? "").split(","),
    ...(env.no_proxy ?? "").split(","),
    "localhost", "127.0.0.1", "::1", "[::1]",
  ].map((entry) => entry.trim()).filter(Boolean));
  env.NO_PROXY = env.no_proxy = [...bypass].join(",");
}
