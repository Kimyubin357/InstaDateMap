const PATHS = new Set(["/", "/search", "/add", "/settings"]);
export function shellDestination(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || !PATHS.has(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
/** Authenticated shell screens use existing memory; API authorization stays server-side. */
export function navigateShell(href: string, replace = false) {
  const destination = shellDestination(href, window.location.origin);
  if (!destination) return false;
  if (destination !== window.location.pathname + window.location.search + window.location.hash) {
    // A fresh state lets Next's native History integration update route hooks without a flight request.
    if (replace) window.history.replaceState(null, "", destination);
    else window.history.pushState(null, "", destination);
  }
  return true;
}
