import { cfgSkills, cfgDisabledExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/settings";
import { loadSkills, type Settings } from "@oh-my-pi/pi-coding-agent";
import { getCompatibleSkillRoots, readSkillInvocationPolicy } from "./skill-compatibility";

export async function loadCompatibleSkills(cwd: string, settings: Settings, roots = getCompatibleSkillRoots(cwd)) {
  const options = cfgSkills.get(settings);
  const result = await loadSkills({
    ...options,
    cwd,
    disabledExtensions: cfgDisabledExtensions.get(settings) ?? [],
    customDirectories: [...new Set([
      ...(options.customDirectories ?? []),
      ...roots,
    ])],
  });
  for (const skill of result.skills) {
    const policy = readSkillInvocationPolicy(skill.baseDir);
    if (policy.hidden) skill.hide = true;
    if (policy.warning) result.warnings.push({ message: policy.warning, skillPath: skill.filePath });
  }
  return result;
}

export function bindCompatibleSkillRefresh(
  session: { refreshSkills(): Promise<void>; settings: Settings; sessionManager: { getCwd(): string } },
  skills: Awaited<ReturnType<typeof loadCompatibleSkills>>["skills"],
) {
  const refresh = session.refreshSkills.bind(session);
  session.refreshSkills = async () => {
    const loaded = await loadCompatibleSkills(session.sessionManager.getCwd(), session.settings);
    skills.splice(0, skills.length, ...loaded.skills);
    await refresh();
  };
}
