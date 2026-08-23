// CommonJS config (not next.config.ts): Next transpiles a `.ts` config through
// SWC, and that native step fails under `bun --bun` on Windows (the runtime the
// app must use, because the omp SDK ships `bun:` builtins). A `.js` config is
// loaded via a plain dynamic import instead, so `bun --bun next start` works on
// every platform. See Next's server/config.js loader (`.ts` -> transpileConfig,
// `.js/.mjs/.cjs` -> import(url)).
const { readFileSync } = require("fs");
const { join } = require("path");

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
let ompVersion = "unknown";
try {
  const ompPkgPath = join(__dirname, "node_modules/@oh-my-pi/pi-coding-agent/package.json");
  ompVersion = JSON.parse(readFileSync(ompPkgPath, "utf8")).version;
} catch { /* package not found, use default */ }

// The omp SDK is published as TypeScript sources and imports `bun:` builtins, so
// webpack must never parse it: every `@oh-my-pi/*` request stays a runtime import
// that Bun resolves itself.
const OMP_SDK_REQUEST = /^@oh-my-pi\//;

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Desktop builds (scripts/stage-desktop.mjs) redirect the production build
  // into src-tauri/server/.next so packaging never touches the dev `.next/`.
  distDir: process.env.OMP_WEB_DIST_DIR || ".next",
  // The end-user installer sets OMP_WEB_FAST_BUILD=1 to skip type checks during
  // `next build` (a dev/CI concern via `bun run typecheck`), which only slows a
  // user's first install. Next 16 no longer supports an `eslint` config key and
  // does not run ESLint during `next build`, so nothing is needed for linting.
  typescript: { ignoreBuildErrors: process.env.OMP_WEB_FAST_BUILD === "1" },
  serverExternalPackages: [
    "undici",
    "@oh-my-pi/pi-coding-agent",
    "@oh-my-pi/pi-agent-core",
    "@oh-my-pi/pi-ai",
    "@oh-my-pi/pi-catalog",
    "@oh-my-pi/pi-tui",
    "@oh-my-pi/pi-utils",
  ],
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer || nextRuntime === "edge") {
      // instrumentation.ts has a Node-only dynamic import guarded by
      // NEXT_RUNTIME. Webpack still traces it for the browser fallback unless
      // the server-only module is explicitly excluded.
      config.resolve.alias["@/lib/http-dispatcher"] = false;
      return config;
    }
    const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
    config.externals = [
      (ctx, callback) => {
        // `import`, not `commonjs`: the SDK's package exports declare only an
        // `import` condition, so a `require()` of it cannot resolve at all.
        const request = ctx && ctx.request;
        if (request && OMP_SDK_REQUEST.test(request)) return callback(undefined, `import ${request}`);
        return callback();
      },
      ...externals,
    ];
    return config;
  },
  // Allow the dev server to be reached over the loopback interface (the browser
  // tab connects to http://127.0.0.1:30141) and from LAN devices.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_OMP_VERSION: ompVersion,
  },
};

module.exports = nextConfig;
