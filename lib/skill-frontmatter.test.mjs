import assert from "node:assert/strict";
import test from "node:test";
import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import { setSkillInvocationDisabled } from "./skill-frontmatter.ts";

test("skill invocation toggles both ways with the SDK's normalized metadata keys", () => {
  const original = "---\nname: review\ndescription: Review changes\ndisable-model-invocation: false\n---\nBody\n";
  const disabled = setSkillInvocationDisabled(original, true);
  assert.equal(parseFrontmatter(disabled).frontmatter.disableModelInvocation, true);
  assert.equal(disabled.match(/disable-model-invocation:/g).length, 1);
  assert.equal(setSkillInvocationDisabled(disabled, true), disabled);
  assert.equal(setSkillInvocationDisabled(disabled, false), original);
});

test("skill toggle repairs conflicting duplicate keys from earlier toggles", () => {
  const original = "---\nname: review\ndisable-model-invocation: true\ndisable-model-invocation: false\n---\nBody";
  for (const disabled of [true, false]) {
    const updated = setSkillInvocationDisabled(original, disabled);
    assert.equal(parseFrontmatter(updated).frontmatter.disableModelInvocation, disabled);
    assert.equal(setSkillInvocationDisabled(updated, disabled), updated);
  }
});

test("skill toggle preserves CRLF, comments, quoted keys, and body content", () => {
  const original = "---\r\nname: 'review' # keep\r\n'disable-model-invocation': false # control\r\n---\r\ndisable-model-invocation: false\r\n";
  assert.equal(setSkillInvocationDisabled(original, true), original.replace("false # control", "true # control"));
  const camelCase = "---\nname: review\ndisableModelInvocation: true\n---\nBody";
  assert.equal(parseFrontmatter(setSkillInvocationDisabled(camelCase, false)).frontmatter.disableModelInvocation, false);
});

test("skill toggle handles missing and empty metadata without changing unrelated content", () => {
  assert.equal(setSkillInvocationDisabled("Body\n", false), "Body\n");
  assert.equal(parseFrontmatter(setSkillInvocationDisabled("Body\n", true)).frontmatter.disableModelInvocation, true);
  assert.equal(setSkillInvocationDisabled("---\nname: review\n---\nBody", true), "---\ndisable-model-invocation: true\nname: review\n---\nBody");
  assert.equal(parseFrontmatter(setSkillInvocationDisabled("---\nname: review\ndisable-model-invocation:\n---\nBody", true)).frontmatter.disableModelInvocation, true);
  assert.equal(parseFrontmatter(setSkillInvocationDisabled("---\n{name: review}\n---\nBody", true)).frontmatter.disableModelInvocation, true);
  assert.throws(() => setSkillInvocationDisabled("---\nname: [broken\n---\nBody", true), /invalid YAML/);
});

test("skill toggle preserves the newline after a block scalar before another key", () => {
  for (const newline of ["\n", "\r\n"]) {
    const original = ["---", "disable-model-invocation: >-", "  false", "name: review", "description: Review changes", "---", "Body"].join(newline);
    const updated = setSkillInvocationDisabled(original, true);
    assert.equal(updated, original.replace(`>-${newline}  false`, "true"));
    const { frontmatter } = parseFrontmatter(updated, { level: "fatal" });
    assert.equal(frontmatter.disableModelInvocation, true);
    assert.equal(frontmatter.name, "review");
  }
});

test("skill toggle preserves the newline after a block scalar before the closing delimiter", () => {
  for (const newline of ["\n", "\r\n"]) {
    const original = ["---", "name: review", "description: Review changes", "disable-model-invocation: |", "  false", "---", "Body"].join(newline);
    const updated = setSkillInvocationDisabled(original, true);
    assert.equal(updated, original.replace(`|${newline}  false`, "true"));
    const { frontmatter, body } = parseFrontmatter(updated, { level: "fatal" });
    assert.equal(frontmatter.disableModelInvocation, true);
    assert.equal(body, "Body");
  }
});
