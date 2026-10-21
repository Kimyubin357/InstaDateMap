export type SheetStop = 0 | 1 | 2;
export function sheetStops(viewportHeight: number): [number, number, number] {
  const height = Math.max(1, viewportHeight);
  return [Math.min(260, height * .35), height * .64, height * .92];
}

/** Positive velocity means dragging down; a short projection makes flicks feel natural. */
export function settleSheet(height: number, velocity: number, stops: readonly number[]): SheetStop | null {
  const projected = height - Math.max(-2, Math.min(2, velocity)) * 160;
  if (projected < stops[0] * .55) return null;
  let nearest: SheetStop = 0;
  for (const index of [1, 2] as const) if (Math.abs(stops[index] - projected) < Math.abs(stops[nearest] - projected)) nearest = index;
  return nearest;
}
