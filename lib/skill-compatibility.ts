import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "yaml";

export function getCompatibleSkillRoots(cwd?: string, home = homedir(), codexHome = process.env.CODEX_HOME): string[] {
  const roots = [
    path.join(home, ".agents", "skills"),
    path.join(codexHome || path.join(home, ".codex"), "skills"),
    path.join(home, ".gemini", "skills"),
    path.join(home, ".gemini", "antigravity", "skills"),
  ];
  if (cwd) {
    for (const directory of [".agents", ".agent", ".codex", ".gemini"]) {
      roots.push(path.join(cwd, directory, "skills"));
    }
  }
  return [...new Set(roots)].filter((root) => existsSync(root));
}

export function readSkillInvocationPolicy(baseDir: string): { hidden: boolean; warning?: string } {
  const policyPath = path.join(baseDir, "agents", "openai.yaml");
  if (!existsSync(policyPath)) return { hidden: false };
  try {
    const metadata = parse(readFileSync(policyPath, "utf8"));
    return { hidden: metadata?.policy?.allow_implicit_invocation === false };
  } catch {
    return { hidden: true, warning: `Invalid agents/openai.yaml: ${policyPath}` };
  }
}
