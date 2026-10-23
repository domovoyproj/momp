import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { annotateSkillsWithInstallInfo, getGlobalSkillsLockPath } =
  await jiti.import("./skill-lock.ts");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeSkill(name, filePath, scope) {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.slice(0, -"/SKILL.md".length),
    disableModelInvocation: false,
    sourceInfo: { scope },
  };
}

test("uses the CLI global lock location", () => {
  assert.equal(
    getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: undefined }),
    join("/home/test", ".agents", ".skill-lock.json"),
  );
  assert.equal(
    getGlobalSkillsLockPath({ homeDir: "/home/test", xdgStateHome: "/state" }),
    join("/state", "skills", ".skill-lock.json"),
  );
});

test("annotates only lock entries that exist in the matching omp scope", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "home", ".omp", "agent");
    const globalLockPath = join(root, "global-lock.json");
    const projectLockPath = join(cwd, "skills-lock.json");
    const globalSkillPath = join(agentDir, "skills", "edge-tts", "SKILL.md");
    const projectSkillPath = join(cwd, ".claude", "skills", "find-skills", "SKILL.md");
    const manualSkillPath = join(agentDir, "skills", "manual", "SKILL.md");
    const otherAgentSkillPath = join(root, "other-agent", "tts", "SKILL.md");

    for (const path of [globalSkillPath, projectSkillPath, manualSkillPath, otherAgentSkillPath]) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "---\nname: test\n---\n", "utf8");
    }

    writeJson(globalLockPath, {
      version: 3,
      skills: {
        "edge-tts": {
          source: "https://github.com/aahl/skills.git",
          sourceType: "github",
          skillPath: "skills/edge-tts/SKILL.md",
          skillFolderHash: "global-version",
        },
        tts: { source: "noizai/skills", sourceType: "github" },
      },
    });
    writeJson(projectLockPath, {
      version: 1,
      skills: {
        "find-skills": {
          source: "vercel-labs/skills",
          sourceType: "github",
          skillPath: "skills/find-skills/SKILL.md",
          computedHash: "project-version",
        },
      },
    });

    const annotated = annotateSkillsWithInstallInfo(
      [
        makeSkill("edge-tts", globalSkillPath, "user"),
        makeSkill("find-skills", projectSkillPath, "project"),
        makeSkill("manual", manualSkillPath, "user"),
        makeSkill("tts", otherAgentSkillPath, "user"),
      ],
      { cwd, agentDir, globalLockPath, projectLockPath },
    );

    assert.deepEqual(annotated[0].install, {
      package: "aahl/skills@edge-tts",
      scope: "global",
      source: "aahl/skills",
      sourceType: "github",
      skillsShUrl: "https://skills.sh/aahl/skills/edge-tts",
      skillPath: "skills/edge-tts/SKILL.md",
      versionHash: "global-version",
      canCheckForUpdates: true,
    });
    assert.deepEqual(annotated[1].install, {
      package: "vercel-labs/skills@find-skills",
      scope: "project",
      source: "vercel-labs/skills",
      sourceType: "github",
      skillsShUrl: "https://skills.sh/vercel-labs/skills/find-skills",
      skillPath: "skills/find-skills/SKILL.md",
      versionHash: "project-version",
      canCheckForUpdates: true,
    });
    assert.equal(annotated[2].install, undefined);
    assert.equal(annotated[3].install, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores stale lock entries and malformed lock files", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const missingPath = join(agentDir, "skills", "missing", "SKILL.md");
    const projectSkillPath = join(cwd, ".claude", "skills", "broken", "SKILL.md");
    const globalLockPath = join(root, "global-lock.json");
    const projectLockPath = join(root, "project-lock.json");
    mkdirSync(join(projectSkillPath, ".."), { recursive: true });
    writeFileSync(projectSkillPath, "---\nname: broken\n---\n", "utf8");
    writeJson(globalLockPath, {
      version: 3,
      skills: {
        missing: { source: "owner/repo", sourceType: "github" },
      },
    });
    writeFileSync(projectLockPath, "not json", "utf8");

    const skills = annotateSkillsWithInstallInfo(
      [
        makeSkill("missing", missingPath, "user"),
        makeSkill("broken", projectSkillPath, "project"),
      ],
      { cwd, agentDir, globalLockPath, projectLockPath },
    );

    assert.equal(skills[0].install, undefined);
    assert.equal(skills[1].install, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not compare a project ref with the default skills.sh snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-web-skill-lock-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const projectLockPath = join(cwd, "skills-lock.json");
    const projectSkillPath = join(cwd, ".claude", "skills", "preview", "SKILL.md");
    mkdirSync(join(projectSkillPath, ".."), { recursive: true });
    writeFileSync(projectSkillPath, "---\nname: preview\n---\n", "utf8");
    writeJson(projectLockPath, {
      version: 1,
      skills: {
        preview: {
          source: "owner/repo",
          sourceType: "github",
          skillPath: "skills/preview/SKILL.md",
          ref: "preview",
          computedHash: "project-version",
        },
      },
    });

    const [skill] = annotateSkillsWithInstallInfo(
      [makeSkill("preview", projectSkillPath, "project")],
      { cwd, agentDir, projectLockPath, globalLockPath: join(root, "missing.json") },
    );

    assert.equal(skill.install.ref, "preview");
    assert.equal(skill.install.canCheckForUpdates, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("annotates compatible project skills using their matching project lock", (context) => {
  const root = mkdtempSync(join(tmpdir(), "momp-compatible-lock-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of [".agents", ".agent", ".codex", ".gemini"]) {
    const filePath = join(root, directory, "skills", "review", "SKILL.md");
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, "---\nname: review\n---\n");
    writeJson(join(root, "skills-lock.json"), { skills: { review: { source: "owner/repo", sourceType: "github", skillPath: "review/SKILL.md", computedHash: "project-version" } } });
    const [skill] = annotateSkillsWithInstallInfo([makeSkill("review", filePath, "project")], {
      cwd: root, agentDir: join(root, "agent"), globalLockPath: join(root, "missing.json"),
    });
    assert.equal(skill.install?.scope, "project", directory);
    assert.equal(skill.install?.canCheckForUpdates, true, directory);
  }
});

test("annotates shared global and custom Codex-home skill layouts", (context) => {
  const root = mkdtempSync(join(tmpdir(), "momp-global-lock-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const homeDir = join(root, "home");
  const codexHome = join(root, "custom-codex");
  const lock = join(root, "global-lock.json");
  writeJson(lock, { skills: { review: { source: "owner/repo", sourceType: "github", skillPath: "review/SKILL.md", skillFolderHash: "global-version" } } });
  for (const directory of [join(homeDir, ".agents"), codexHome, join(homeDir, ".gemini"), join(homeDir, ".gemini", "antigravity")]) {
    const filePath = join(directory, "skills", "review", "SKILL.md");
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, "---\nname: review\n---\n");
    const [skill] = annotateSkillsWithInstallInfo([makeSkill("review", filePath, "user")], {
      cwd: join(root, "project"), agentDir: join(homeDir, ".omp", "agent"), globalLockPath: lock, homeDir, codexHome,
    });
    assert.equal(skill.install?.scope, "global", directory);
    assert.equal(skill.install?.canCheckForUpdates, true, directory);
  }
});
