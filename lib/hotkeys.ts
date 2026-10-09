/**
 * Every modal and popover in the app uses one of these classes (components/Dialog.tsx, the save modal in
 * App.tsx, SelectField's popover). react-aria only mounts them while open (or animating closed).
 */
const OVERLAY = ".modal-overlay, .popover";

/**
 * Whether a global shortcut should leave this key alone: while a modal or popover is open, while typing,
 * with a modifier held, or Enter/Space on an interactive element (which handles them itself).
 */
export function shouldIgnoreKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey || !t?.closest) return true;
  if (document.querySelector(OVERLAY)) return true;
  if (t.closest("input, textarea")) return true;
  // Tabs use the arrow keys (and Home/End) to move between tabs; everything else is free for shortcuts.
  if (/^(Arrow|Home$|End$)/.test(e.key) && t.closest("[role=tab]")) return true;
  if ((e.key === "Enter" || e.key === " ") && t.closest("button, a, [role=button], [role=option], [role=tab]")) return true;
  return false;
}
