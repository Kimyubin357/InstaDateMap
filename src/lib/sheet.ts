export type SheetStop = 0 | 1 | 2;
/** At the content edge, expand before scrolling; a full sheet scrolls upward natively. */
export function contentPullDecision(scrollTop: number, dx: number, dy: number, stop: SheetStop = 2): "pending" | "scroll" | "sheet" {
  if (scrollTop > 1) return "scroll";
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return "pending";
  return (dy > 0 || stop < 2) && Math.abs(dy) > Math.abs(dx) * 1.2 ? "sheet" : "scroll";
}
export function sheetStops(viewportHeight: number, content?: { collapsed: number; preview: number }): [number, number, number] {
  const height = Math.max(1, viewportHeight);
  if (content) {
    // Short landscape/keyboard viewports retain three stops and a usable scroll area.
    const minimum = Math.min(content.collapsed, height * .65);
    const middle = Math.min(height * .88, Math.max(minimum + height * .12, content.collapsed + content.preview));
    return [minimum, middle, height];
  }
  return [height * .48, height * .635, height * .92];
}

/** A downward gesture visits the next stop; only the lowest stop can dismiss. */
export function settleSheet(height: number, velocity: number, stops: readonly number[], start: { stop: SheetStop; height: number }): SheetStop | null {
  const lower = Math.max(0, start.stop - 1) as SheetStop;
  if (start.stop > 0 && height < start.height - 5) return lower;
  if (start.stop < 2 && height > start.height + 24) return (start.stop + 1) as SheetStop;
  const projected = height - Math.max(-2, Math.min(2, velocity)) * 160;
  if (projected < stops[0] * .55) return start.stop === 0 ? null : lower;
  let nearest: SheetStop = 0;
  for (const index of [1, 2] as const) if (Math.abs(stops[index] - projected) < Math.abs(stops[nearest] - projected)) nearest = index;
  return Math.min(start.stop + 1, Math.max(lower, nearest)) as SheetStop;
}
