import type { ShareResult } from "./share-stream";

/** Return to the map itself, without reopening a place detail sheet. */
export function savedMapHref(placeUrl?: string) {
  try {
    const id = new URL(placeUrl || "/", "https://datemap.local").searchParams.get("place");
    if (id && /^[a-z0-9-]+$/i.test(id)) return `/?saved=${encodeURIComponent(id)}`;
  } catch { /* A saved result can still return to the full map. */ }
  return "/?saved=1";
}

export function shareDestination(result: ShareResult): string | null {
  if (result.status === "saved" || result.status === "duplicate") return savedMapHref(result.place_url) + (result.status === "duplicate" ? "&duplicate=1" : "");
  if (result.status === "confirm") return confirmPath(result.confirm_url);
  return null;
}

function confirmPath(confirmUrl?: string): string | null {
  if (!confirmUrl) return null;
  try {
    const url = new URL(confirmUrl, "https://datemap.local");
    if (/^\/confirm\/[a-z0-9-]+$/i.test(url.pathname)) return url.pathname;
  } catch { /* Keep failures on the recovery screen. */ }
  return null;
}

/**
 * 이름은 읽었지만 지도에서 하나도 못 찾았거나 이름을 못 읽은 링크(needs_review)는 실패 화면이 아니라
 * 장소 확인 화면으로 보냅니다. 거기서 장소마다 '이름으로 찾기'를 하거나 다시 분석합니다.
 */
export function reviewDestination(result: ShareResult): string | null {
  return result.status === "needs_review" ? confirmPath(result.confirm_url) : null;
}
