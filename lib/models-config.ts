import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

export function readModelsConfig(agentDir: string): Record<string, unknown> {
  for (const name of ["models.yml", "models.yaml", "models.json"]) {
    let content: string;
    try {
      content = readFileSync(join(agentDir, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Unable to read ${name}; existing configuration was not changed`);
    }
    let config: unknown;
    try {
      config = parse(content);
    } catch {
      throw new Error(`Invalid ${name}; existing configuration was not changed`);
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new Error(`${name} must contain a configuration object`);
    }
    const record = config as Record<string, unknown>;
    if ("providers" in record && (typeof record.providers !== "object" || record.providers === null || Array.isArray(record.providers))) {
      throw new Error(`${name} providers must be an object`);
    }
    return record;
  }
  return { providers: {} };
}
