/* Push only: do not cache PIN responses, pages, map tiles, or API data. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
function placeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && url.pathname === "/" && /^[0-9a-f-]{36}$/i.test(url.searchParams.get("place") || "")) return `/?place=${encodeURIComponent(url.searchParams.get("place"))}`;
  } catch {}
  return "/";
}
self.addEventListener("push", (event) => {
  let payload = {}; try { payload = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(typeof payload.title === "string" ? payload.title.slice(0, 100) : "우리 지도에 새 장소가 생겼어요", {
    body: typeof payload.body === "string" ? payload.body.slice(0, 160) : "같이 가볼 곳을 확인해 보세요.",
    icon: "/icons/canvas-heart-192.png", badge: "/icons/canvas-heart-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "datemap-place", renotify: true, data: { url: placeUrl(payload.url) },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close(); const target = new URL(placeUrl(event.notification.data?.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try { const navigated = await client.navigate(target); if (navigated) return navigated.focus(); } catch {}
    }
    return self.clients.openWindow(target);
  })());
});
