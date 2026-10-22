import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateShell, shellDestination } from "@/lib/shell-navigation";
afterEach(() => vi.unstubAllGlobals());
describe("서버 응답을 기다리지 않는 앱 화면 이동", () => {
  it("인증된 앱에서 제공하는 네 화면만 즉시 전환 대상으로 선택", () => {
    for (const path of ["/", "/?view=list", "/search?q=수원", "/add?url=test", "/settings"]) expect(shellDestination(path, "https://map.test")).not.toBeNull();
    for (const path of ["https://evil.test/", "/api/places", "/enter", "/setup", "/confirm/id"]) expect(shellDestination(path, "https://map.test")).toBeNull();
  });
  it("새 History 상태로 이동해 라우트 훅을 갱신하고 서버 요청을 만들지 않음", () => {
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    vi.stubGlobal("window", { history, location: { origin: "https://map.test", pathname: "/", search: "", hash: "" } });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(navigateShell("/?view=list")).toBe(true); expect(history.pushState).toHaveBeenCalledWith(null, "", "/?view=list");
    expect(navigateShell("/settings", true)).toBe(true); expect(history.replaceState).toHaveBeenCalledWith(null, "", "/settings");
    expect(navigateShell("/")).toBe(true); expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(navigateShell("https://evil.test/")).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it("확인·입장 페이지에서는 라우터가 인증과 이전 페이지 교체를 처리하도록 남겨 둠", () => {
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    for (const pathname of ["/confirm/source-id", "/enter", "/setup"]) {
      vi.stubGlobal("window", { history, location: { origin: "https://map.test", pathname, search: "", hash: "" } });
      expect(navigateShell("/?saved=place-id", true)).toBe(false);
      expect(navigateShell("/add")).toBe(false);
    }
    expect(history.pushState).not.toHaveBeenCalled(); expect(history.replaceState).not.toHaveBeenCalled();
  });
});
