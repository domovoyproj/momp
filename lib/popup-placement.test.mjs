import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./popup-placement.ts");
}

test("keeps the preferred side when it can hold the popup", async () => {
  const { computePopupPlacement } = await loadSubject();
  // Composer near the bottom: 600px of room above for a 400px popup.
  assert.deepEqual(
    computePopupPlacement(620, 660, 700, 400, { prefer: "above" }),
    { side: "above", maxHeight: 400 },
  );
});

test("flips to the roomier side when the preferred one is too small", async () => {
  const { computePopupPlacement } = await loadSubject();
  // Fresh session: the composer sits mid-viewport with little room above it.
  const placement = computePopupPlacement(120, 170, 900, 460, { prefer: "above" });
  assert.equal(placement.side, "below");
  assert.equal(placement.maxHeight, 460);
});

test("caps the height to the space on the chosen side", async () => {
  const { computePopupPlacement } = await loadSubject();
  // 300px above and 220px below: stay above, but do not claim the full 460px.
  const placement = computePopupPlacement(316, 460, 700, 460, { prefer: "above" });
  assert.equal(placement.side, "above");
  assert.equal(placement.maxHeight, 300);
});

test("opens a settings dropdown upwards when it would run past the viewport", async () => {
  const { computePopupPlacement } = await loadSubject();
  // Trigger near the bottom of a 125%-zoom viewport: only 40px left below.
  const placement = computePopupPlacement(560, 594, 640, 296, { prefer: "below", gap: 5, minHeight: 160 });
  assert.equal(placement.side, "above");
  assert.equal(placement.maxHeight, 296);
});

test("never shrinks below the floor, and never past a very short viewport", async () => {
  const { computePopupPlacement } = await loadSubject();
  assert.equal(computePopupPlacement(30, 60, 400, 360, { prefer: "above" }).maxHeight, 324);
  // Viewport shorter than the floor: use the viewport minus its margins.
  assert.equal(computePopupPlacement(40, 70, 100, 360, { prefer: "above" }).maxHeight, 84);
});

test("derives the preferred height from the viewport with an absolute cap", async () => {
  const { preferredPopupHeight } = await loadSubject();
  assert.equal(preferredPopupHeight(1000, 0.56, 460), 460);
  assert.equal(preferredPopupHeight(500, 0.56, 460), 280);
});
