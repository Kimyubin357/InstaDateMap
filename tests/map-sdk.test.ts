import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Script = { id: string; src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; remove: ReturnType<typeof vi.fn>; removed?: boolean };
let appended: Script[];

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); appended = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {
    createElement: () => {
      const script: Script = { id: "", src: "", async: false, onload: null, onerror: null, remove: vi.fn(() => { script.removed = true; }) };
      return script;
    },
    getElementById: (id: string) => appended.find((script) => script.id === id && !script.removed),
    head: { appendChild: (script: Script) => appended.push(script) },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("지도 스크립트 요청 복구", () => {
  it("동시 요청은 하나로 공유하고 성공한 스크립트는 다시 내려받지 않음", async () => {
    const { loadScript } = await import("@/lib/scripts");
    const first = loadScript("sdk.js", "sdk"), second = loadScript("sdk.js", "sdk");
    expect(first).toBe(second); expect(appended).toHaveLength(1);
    appended[0].onload!(); await first;
    expect(loadScript("sdk.js", "sdk")).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("첫 다운로드 실패 뒤 새 요청으로 성공할 수 있음", async () => {
    const { loadScript } = await import("@/lib/scripts");
    const first = loadScript("sdk.js", "sdk"), failed = expect(first).rejects.toThrow("불러오지 못했어요");
    appended[0].onerror!(); await failed;
    expect(appended[0].removed).toBe(true);
    const retry = loadScript("sdk.js", "sdk");
    expect(appended).toHaveLength(2); appended[1].onload!(); await retry;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("다운로드가 멎으면 제한 시간 뒤 정리하고 늦은 응답을 무시함", async () => {
    const { loadScript } = await import("@/lib/scripts");
    const first = loadScript("sdk.js", "sdk"), lateLoad = appended[0].onload!;
    const failed = expect(first).rejects.toThrow("시간이 길어졌어요");
    await vi.advanceTimersByTimeAsync(15000); await failed;
    expect(appended[0].removed).toBe(true); expect(appended[0].onload).toBe(null);
    const retry = loadScript("sdk.js", "sdk"); lateLoad();
    expect(loadScript("sdk.js", "sdk")).toBe(retry);
    appended[1].onload!(); await retry;
  });
});

describe("메인 지도와 미리보기의 SDK 준비", () => {
  it("다운로드뿐 아니라 내부 SDK 준비까지 공유해서 초기화를 중복 요청하지 않음", async () => {
    const { loadKakaoMaps } = await import("@/lib/map-sdk");
    let ready = () => {};
    const maps = { load: vi.fn((callback: () => void) => { ready = callback; }), Map: undefined as undefined | (() => void) };
    window.kakao = { maps };
    const main = loadKakaoMaps("test-key"), preview = loadKakaoMaps("test-key");
    expect(main).toBe(preview); expect(appended).toHaveLength(1);
    appended[0].onload!(); await Promise.resolve();
    expect(maps.load).toHaveBeenCalledTimes(1);
    maps.Map = () => {}; ready();
    expect(await main).toBe(maps); expect(await preview).toBe(maps);
    expect(await loadKakaoMaps("test-key")).toBe(maps); expect(appended).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("SDK 준비 콜백이 오지 않아도 실패를 알리고 재시도할 수 있음", async () => {
    const { loadKakaoMaps } = await import("@/lib/map-sdk");
    const maps = { load: vi.fn(), Map: undefined as undefined | (() => void) };
    window.kakao = { maps };
    const first = loadKakaoMaps("test-key"), failed = expect(first).rejects.toThrow("시간이 길어졌어요");
    appended[0].onload!(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000); await failed;
    expect(appended[0].removed).toBe(true);
    const retry = loadKakaoMaps("test-key"); expect(appended).toHaveLength(2);
    maps.load.mockImplementation((callback: () => void) => { maps.Map = () => {}; callback(); });
    appended[1].onload!(); expect(await retry).toBe(maps);
  });
  it("네트워크 실패 후 다른 지도에서 다시 요청해도 실패 캐시가 남지 않음", async () => {
    const { loadKakaoMaps } = await import("@/lib/map-sdk");
    const first = loadKakaoMaps("test-key"), failed = expect(first).rejects.toThrow();
    appended[0].onerror!(); await failed;
    const maps = { load: (callback: () => void) => { maps.Map = () => {}; callback(); }, Map: undefined as undefined | (() => void) };
    window.kakao = { maps };
    const retry = loadKakaoMaps("test-key"); appended[1].onload!();
    expect(await retry).toBe(maps);
  });
  it("이미 준비된 지도는 재접속 때 SDK를 다시 만들지 않음", async () => {
    const { loadKakaoMaps } = await import("@/lib/map-sdk");
    const maps = { Map: () => {}, load: vi.fn() }; window.kakao = { maps };
    expect(await loadKakaoMaps("test-key")).toBe(maps);
    expect(maps.load).not.toHaveBeenCalled(); expect(appended).toHaveLength(0);
  });
});
