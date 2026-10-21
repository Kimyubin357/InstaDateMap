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
  if (result.status === "confirm" && result.confirm_url) {
    try {
      const url = new URL(result.confirm_url, "https://datemap.local");
      if (/^\/confirm\/[a-z0-9-]+$/i.test(url.pathname)) return url.pathname;
    } catch { /* Keep failures on the recovery screen. */ }
  }
  return null;
}
