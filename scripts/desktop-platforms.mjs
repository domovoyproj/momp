export function desktopPlatformPlan(platform, architecture, universal = false) {
  if (platform === "win32" && architecture === "x64") {
    return {
      triples: ["windows-x64"],
      nativeVariants: [
        ["@next/swc-win32-x64-msvc", "next"],
        ["@oh-my-pi/pi-natives-win32-x64", "@oh-my-pi/pi-natives"],
        ["@oh-my-pi/omp-stats", "@oh-my-pi/omp-stats"],
      ],
    };
  }
  if (platform !== "darwin" || !["arm64", "x64"].includes(architecture)) {
    throw new Error(`Unsupported desktop build target: ${platform}-${architecture}`);
  }
  const architectures = universal ? ["arm64", "x64"] : [architecture];
  return {
    triples: architectures.map((target) => `darwin-${target === "arm64" ? "aarch64" : "x64"}`),
    nativeVariants: [
      ...architectures.flatMap((target) => [
        [`@next/swc-darwin-${target}`, "next"],
        [`@oh-my-pi/pi-natives-darwin-${target}`, "@oh-my-pi/pi-natives"],
      ]),
      ["@oh-my-pi/omp-stats", "@oh-my-pi/omp-stats"],
    ],
  };
}
