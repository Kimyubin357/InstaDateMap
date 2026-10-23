import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync("public/sw.js", "utf8");
function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const show = vi.fn(async (_title: string, _options: Record<string, unknown>) => {}), openWindow = vi.fn(async () => {}), focus = vi.fn(async () => {});
  const navigate = vi.fn(async () => ({ focus }));
  const self = { location: { origin: "https://map.example" }, skipWaiting: vi.fn(), registration: { showNotification: show },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [{ url: "https://map.example/", navigate }]), openWindow },
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } };
  vm.runInNewContext(source, { self, URL });
  return { handlers, show, navigate, openWindow, self };
}
describe("알림 전용 서비스 워커", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  it("수신한 장소 알림을 화면에 표시하고 방문 주소를 보존함", async () => {
    const w = worker(); let task: Promise<unknown> = Promise.resolve();
    w.handlers.push({ data: { json: () => ({ title: "새 장소", body: "카페", url: `/?place=${id}`, tag: "event" }) }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task; expect(w.show).toHaveBeenCalledWith("새 장소", expect.objectContaining({ body: "카페", data: { url: `/?place=${id}` } }));
  });
  it("알림을 눌러 열린 창에서 해당 장소로 이동하고 포커스함", async () => {
    const w = worker(); let task: Promise<unknown> = Promise.resolve();
    w.handlers.notificationclick({ notification: { close() {}, data: { url: `/?place=${id}` } }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task; expect(w.navigate).toHaveBeenCalledWith(`https://map.example/?place=${id}`); expect(w.openWindow).not.toHaveBeenCalled();
  });
  it("외부 주소와 토큰 주소로 이동하지 않고 빈 payload도 조용히 버리지 않음", async () => {
    const w = worker(); let task: Promise<unknown> = Promise.resolve();
    w.handlers.push({ data: { json: () => ({ url: "https://evil.example/?t=secret" }) }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task; expect(w.show.mock.calls[0][1]).toMatchObject({ data: { url: "/" } });
    expect(w.handlers.fetch).toBeUndefined();
  });
  it("앱이 닫혀 있으면 해당 장소 주소로 새 창을 엶", async () => {
    const w = worker(); w.self.clients.matchAll.mockResolvedValue([]); let task: Promise<unknown> = Promise.resolve();
    w.handlers.notificationclick({ notification: { close() {}, data: { url: `/?place=${id}` } }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task; expect(w.openWindow).toHaveBeenCalledWith(`https://map.example/?place=${id}`);
  });
});
