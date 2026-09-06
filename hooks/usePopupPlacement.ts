"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";
import {
  computePopupPlacement,
  preferredPopupHeight,
  type PopupPlacement,
  type PopupPlacementOptions,
} from "@/lib/popup-placement";

export interface PopupSizing extends PopupPlacementOptions {
  /** Preferred height as a share of the viewport (e.g. 0.56 for 56vh). */
  viewportFraction: number;
  /** Absolute cap on the preferred height, in pixels. */
  cap: number;
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * Track where a popup anchored to `anchorRef` should open and how tall it may
 * be. Recomputed while open on resize, zoom, and layout changes of the anchor
 * (the composer grows as the user types), so a popup never runs off-screen.
 */
export function usePopupPlacement(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  sizing: PopupSizing,
): PopupPlacement {
  const { viewportFraction, cap, gap, margin, minHeight, prefer } = sizing;
  const [placement, setPlacement] = useState<PopupPlacement>({
    side: prefer ?? "above",
    maxHeight: cap,
  });

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const height = viewportHeight();
    const rect = anchor.getBoundingClientRect();
    const next = computePopupPlacement(
      rect.top,
      rect.bottom,
      height,
      preferredPopupHeight(height, viewportFraction, cap),
      { gap, margin, minHeight, prefer },
    );
    setPlacement((current) => (
      current.side === next.side && current.maxHeight === next.maxHeight ? current : next
    ));
  }, [anchorRef, cap, gap, margin, minHeight, prefer, viewportFraction]);

  useEffect(() => {
    if (!open) return;
    measure();

    const anchor = anchorRef.current;
    const observer = anchor ? new ResizeObserver(measure) : null;
    if (anchor && observer) observer.observe(anchor);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [anchorRef, measure, open]);

  return placement;
}
