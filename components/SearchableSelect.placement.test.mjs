import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./SearchableSelect.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./SearchableSelect.module.css", import.meta.url), "utf8");
const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("opens the option list on whichever side of the trigger has room", () => {
  assert.match(source, /usePopupPlacement\(rootRef, open, \{[\s\S]*?prefer: "below"/);
  assert.match(source, /side === "above"\s*\?\s*\{ bottom: `calc\(100% \+ \$\{POPOVER_GAP_PX\}px\)`, maxHeight \}/);
  assert.match(source, /\{ top: `calc\(100% \+ \$\{POPOVER_GAP_PX\}px\)`, maxHeight \}/);
  // The side is chosen per open, so the stylesheet must not pin one.
  assert.doesNotMatch(css, /^\s*top: calc\(100% \+ 5px\);/m);
});

test("bounds the option list to the measured popover height", () => {
  assert.match(source, /className=\{styles\.options\}[\s\S]*?maxHeight: Math\.max\(0, maxHeight - POPOVER_CHROME_PX\)/);
});

test("scrolls the keyboard-active option into view", () => {
  assert.match(source, /optionRefs\.current\[activeIndex\]\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /ref=\{\(node\) => \{ optionRefs\.current\[index\] = node; \}\}/);
});

test("sizes the composer popups from the space around the composer", () => {
  for (const name of ["historyPlacement", "slashPlacement", "atPlacement"]) {
    assert.match(chatInputSource, new RegExp(`const ${name} = usePopupPlacement\\(composerAnchorRef,`));
    assert.match(chatInputSource, new RegExp(`\\.\\.\\.popupOffset\\(${name}\\.side\\)`));
    assert.match(chatInputSource, new RegExp(`maxHeight: ${name}\\.maxHeight`));
  }
  // No popup may keep a fixed vh height that ignores the composer's position.
  assert.doesNotMatch(chatInputSource, /maxHeight: "min\(\d+vh/);
  assert.doesNotMatch(chatInputSource, /bottom: "calc\(100% \+ 8px\)"/);
});

test("flips the composer model picker below the trigger when needed", () => {
  assert.match(chatInputSource, /const \{ side, maxHeight: maxH \} = computePopupPlacement\(/);
  assert.match(chatInputSource, /side === "above"\s*\?\s*\{ bottom: viewportHeight - modelDropdownRect\.top \+ 6 \}\s*:\s*\{ top: modelDropdownRect\.bottom \+ 6 \}/);
  assert.match(chatInputSource, /setModelDropdownRect\(\{ top: rect\.top, bottom: rect\.bottom,/);
});
