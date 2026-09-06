export type PopupSide = "above" | "below";

export interface PopupPlacement {
  side: PopupSide;
  maxHeight: number;
}

export const POPUP_GAP_PX = 8;
export const POPUP_VIEWPORT_MARGIN_PX = 8;
export const POPUP_MIN_HEIGHT_PX = 120;

export interface PopupPlacementOptions {
  /** Distance between the anchor and the popup. */
  gap?: number;
  /** Space kept between the popup and the viewport edge. */
  margin?: number;
  /** Never shrink below this, so a cramped popup still shows something. */
  minHeight?: number;
  /** Side to use whenever it can hold the popup. */
  prefer?: PopupSide;
}

/**
 * Pick the side of an anchor with room for a popup and cap its height to the
 * space actually available there. Anchor coordinates are viewport-relative
 * (as returned by getBoundingClientRect), so this accounts for browser zoom
 * and, when `viewportHeight` comes from visualViewport, for on-screen
 * keyboards too.
 */
export function computePopupPlacement(
  anchorTop: number,
  anchorBottom: number,
  viewportHeight: number,
  preferredMaxHeight: number,
  options: PopupPlacementOptions = {},
): PopupPlacement {
  const gap = options.gap ?? POPUP_GAP_PX;
  const margin = options.margin ?? POPUP_VIEWPORT_MARGIN_PX;
  const prefer = options.prefer ?? "above";
  // A viewport too short for the floor gets the whole viewport instead, rather
  // than a popup that reaches past both edges.
  const floor = Math.min(options.minHeight ?? POPUP_MIN_HEIGHT_PX, Math.max(0, viewportHeight - margin * 2));

  const spaceAbove = Math.max(0, anchorTop - gap - margin);
  const spaceBelow = Math.max(0, viewportHeight - anchorBottom - gap - margin);
  const preferredSpace = prefer === "above" ? spaceAbove : spaceBelow;
  const otherSpace = prefer === "above" ? spaceBelow : spaceAbove;

  // Stay on the preferred side unless it cannot fit the popup and the other
  // side has more room; flipping for a marginal gain only makes it jumpy.
  const keepPreferred = preferredSpace >= preferredMaxHeight || preferredSpace >= otherSpace;
  const side: PopupSide = keepPreferred ? prefer : (prefer === "above" ? "below" : "above");
  const space = keepPreferred ? preferredSpace : otherSpace;

  return { side, maxHeight: Math.max(floor, Math.min(preferredMaxHeight, space)) };
}

/** Preferred height as a share of the viewport, capped at an absolute value. */
export function preferredPopupHeight(viewportHeight: number, viewportFraction: number, cap: number): number {
  return Math.min(viewportHeight * viewportFraction, cap);
}
