export type SheetStop = 0 | 1 | 2;
/** Leave native scrolling alone until a new, clearly downward pull starts at the top. */
export function contentPullDecision(scrollTop: number, dx: number, dy: number): "pending" | "scroll" | "sheet" {
  if (scrollTop > 1) return "scroll";
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return "pending";
  return dy > Math.abs(dx) * 1.2 ? "sheet" : "scroll";
}
export function sheetStops(viewportHeight: number): [number, number, number] {
  const height = Math.max(1, viewportHeight);
  return [height * .48, height * .635, height * .92];
}

/** Positive velocity means dragging down; a short projection makes flicks feel natural. */
export function settleSheet(height: number, velocity: number, stops: readonly number[]): SheetStop | null {
  const projected = height - Math.max(-2, Math.min(2, velocity)) * 160;
  if (projected < stops[0] * .55) return null;
  let nearest: SheetStop = 0;
  for (const index of [1, 2] as const) if (Math.abs(stops[index] - projected) < Math.abs(stops[nearest] - projected)) nearest = index;
  return nearest;
}
