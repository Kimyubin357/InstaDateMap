export interface Coordinates { lat: number; lng: number }

/** Animate even distant places, which Kakao's panTo otherwise jumps to. */
export function animateMapCenter(from: Coordinates, to: Coordinates, draw: (point: Coordinates) => void, duration = 440) {
  if (duration <= 0) { draw(to); return () => {}; }
  const start = performance.now();
  let frame = 0, cancelled = false;
  const tick = (now: number) => {
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = 1 - (1 - progress) ** 3;
    draw(progress === 1 ? to : { lat: from.lat + (to.lat - from.lat) * eased, lng: from.lng + (to.lng - from.lng) * eased });
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { cancelled = true; cancelAnimationFrame(frame); };
}
