import { isMap, isScalar, parseDocument } from "yaml";

export function setSkillInvocationDisabled(content: string, disabled: boolean): string {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  if (!opening) {
    return disabled ? `---${newline}disable-model-invocation: true${newline}---${newline}${content}` : content;
  }
  const remainder = content.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  if (!closing) throw new Error("Skill frontmatter has no closing delimiter");
  const metadata = remainder.slice(0, closing.index);
  const document = parseDocument(metadata, { uniqueKeys: false });
  if (document.errors.length) throw new Error("Skill frontmatter is invalid YAML");
  if (document.contents && !isMap(document.contents)) throw new Error("Skill frontmatter must be a mapping");

  const changes: { start: number; end: number; value: string }[] = [];
  let found = false;
  if (isMap(document.contents)) {
    for (const entry of document.contents.items) {
      if (!isScalar(entry.key) || !["disable-model-invocation", "disableModelInvocation"].includes(String(entry.key.value))) continue;
      found = true;
      if (isScalar(entry.value) && entry.value.value === disabled) continue;
      if (entry.value?.range) {
        const [start, end] = entry.value.range;
        const trailingNewlines = metadata.slice(start, end).match(/(?:\r?\n)+$/)?.[0] ?? "";
        changes.push({ start, end, value: String(disabled) + trailingNewlines });
      } else if (entry.key.range) {
        const start = metadata.indexOf(":", entry.key.range[1]) + 1;
        changes.push({ start, end: start, value: ` ${disabled}` });
      }
    }
  }
  if (!found && disabled) {
    if (isMap(document.contents) && document.contents.flow && document.contents.range) {
      const start = document.contents.range[0] + 1;
      const separator = document.contents.items.length ? ", " : "";
      changes.push({ start, end: start, value: `disable-model-invocation: true${separator}` });
    } else {
      changes.push({ start: 0, end: 0, value: `disable-model-invocation: true${newline}` });
    }
  }
  let updated = metadata;
  for (const change of changes.sort((left, right) => right.start - left.start)) {
    updated = updated.slice(0, change.start) + change.value + updated.slice(change.end);
  }
  return opening[0] + updated + remainder.slice(closing.index);
}
