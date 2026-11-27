/**
 * Where the toast stack goes so it never covers an open drawer's or dialog's actions. Toasts sit in
 * the bottom-right corner, which is exactly where a drawer keeps its primary action: with an overlay
 * open, they move beside it when there is room, else above its actions, else to the top.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** An open drawer or dialog: its whole panel, and the row of buttons that must stay reachable. */
export interface OverlayBoxes {
  panel: Box;
  actions: Box;
}
/** Offsets from the viewport's right and bottom edges, in CSS pixels. */
export interface ToastOffsets {
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * The offsets for a stack of the given size, or null for the default corner (`gap` from the right
 * and bottom edges), which the stylesheet places.
 */
export function placeToastStack(
  viewport: { width: number; height: number },
  stack: { width: number; height: number },
  overlays: readonly OverlayBoxes[],
  gap: number,
): ToastOffsets | null {
  if (overlays.length === 0 || stack.height <= 0) return null;
  const box = ({ right, bottom }: ToastOffsets): Box => {
    const edge = viewport.width - right, base = viewport.height - bottom;
    return { left: edge - stack.width, top: base - stack.height, right: edge, bottom: base };
  };
  const fits = (offsets: ToastOffsets) => {
    const placed = box(offsets);
    return placed.left >= 0 && placed.top >= 0;
  };
  const panelsLeft = Math.min(...overlays.map((overlay) => overlay.panel.left));
  const actionsTop = Math.min(...overlays.map((overlay) => overlay.actions.top));
  const candidates: ToastOffsets[] = [
    { right: gap, bottom: gap },
    // Beside the overlays, in the page they cover.
    { right: viewport.width - panelsLeft + gap, bottom: gap },
    // Above the actions, over the overlay's own content.
    { right: gap, bottom: viewport.height - actionsTop + gap },
    // At the top of the screen.
    { right: gap, bottom: viewport.height - gap - stack.height },
  ];
  const chosen =
    candidates.find((offsets) => fits(offsets) && overlays.every((overlay) => !overlaps(box(offsets), overlay.panel))) ??
    candidates.find((offsets) => fits(offsets) && overlays.every((overlay) => !overlaps(box(offsets), overlay.actions)));
  if (!chosen || (chosen.right === gap && chosen.bottom === gap)) return null;
  return chosen;
}

/** Open drawers and dialogs, outside the toast stack, with their action rows. */
export const OVERLAY_SELECTOR = '[aria-modal="true"]';
/**
 * The row of buttons in a drawer or dialog, and the step-up notice beside it: kept clear together.
 * An overlay with neither is avoided whole.
 */
export const OVERLAY_ACTIONS_SELECTOR = ':scope > .drawer-footer, :scope > .confirm-actions, :scope > .step-up-notice--shown';

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
const union = (boxes: Box[]): Box => ({
  left: Math.min(...boxes.map((box) => box.left)),
  top: Math.min(...boxes.map((box) => box.top)),
  right: Math.max(...boxes.map((box) => box.right)),
  bottom: Math.max(...boxes.map((box) => box.bottom)),
});

/** Measure the open drawers and dialogs in a document. */
export function measureOverlays(root: ParentNode, exclude?: Element | null): OverlayBoxes[] {
  return [...root.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)]
    .filter((element) => !exclude?.contains(element) && element.getClientRects().length > 0)
    .map((element) => {
      const panel = boxOf(element.getBoundingClientRect());
      const actions = [...element.querySelectorAll<HTMLElement>(OVERLAY_ACTIONS_SELECTOR)].map((item) => boxOf(item.getBoundingClientRect()));
      return { panel, actions: actions.length > 0 ? union(actions) : panel };
    });
}
