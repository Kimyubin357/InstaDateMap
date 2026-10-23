import { afterEach, describe, expect, it, vi } from "vitest";
import { installEdgeBackGuard, isStandaloneIOS } from "@/lib/edge-navigation";

const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5, standalone: true, displayModeStandalone: false };

class TestElement extends EventTarget {
  constructor(readonly control = false) { super(); }
  closest() { return this.control ? this : null; }
}

function touch(x: number, { count = 1, changed = 1, cancelable = true } = {}) {
  const event = new Event("touchstart", { cancelable, bubbles: true });
  Object.defineProperties(event, {
    touches: { value: Array.from({ length: count }, () => ({ clientX: x })) },
    changedTouches: { value: Array.from({ length: changed }, () => ({ clientX: x })) },
  });
  return event;
}

afterEach(() => vi.unstubAllGlobals());

describe("설치한 iOS 앱의 왼쪽 끝 뒤로가기 제스처", () => {
  it("홈 화면 iPhone/iPad에만 적용하고 Safari 탭·Android·Mac은 유지", () => {
    expect(isStandaloneIOS(iphone)).toBe(true);
    expect(isStandaloneIOS({ ...iphone, standalone: false, displayModeStandalone: true })).toBe(true);
    expect(isStandaloneIOS({ ...iphone, userAgent: "Macintosh", platform: "MacIntel" })).toBe(true);
    expect(isStandaloneIOS({ ...iphone, standalone: false })).toBe(false);
    expect(isStandaloneIOS({ ...iphone, userAgent: "Android", platform: "Linux" })).toBe(false);
    expect(isStandaloneIOS({ ...iphone, userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("왼쪽 20px의 단일 터치만 취소하고 지도·카드 중앙과 오른쪽 끝은 건드리지 않음", () => {
    vi.stubGlobal("Element", TestElement);
    const root = new TestElement(); installEdgeBackGuard(root, iphone);
    for (const x of [0, 1, 20]) {
      const event = touch(x); root.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    }
    for (const x of [-1, 21, 195, 390, Number.NaN]) {
      const event = touch(x); root.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
  });

  it("두 손가락 확대·축소나 취소할 수 없는 OS 이벤트에는 개입하지 않음", () => {
    vi.stubGlobal("Element", TestElement);
    const root = new TestElement(); installEdgeBackGuard(root, iphone);
    for (const options of [{ count: 2 }, { changed: 2 }, { count: 0 }, { cancelable: false }]) {
      const event = touch(0, options); root.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
  });

  it("화면 가장자리의 앱 버튼·링크·입력칸의 탭 기본 동작은 보존", () => {
    vi.stubGlobal("Element", TestElement);
    const control = new TestElement(true); installEdgeBackGuard(control, iphone);
    const event = touch(10); control.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });

  it("이벤트 전파를 멈추지 않아 시트·지도의 자체 터치 핸들러가 실행됨", () => {
    vi.stubGlobal("Element", TestElement);
    const root = new TestElement(); installEdgeBackGuard(root, iphone);
    const handler = vi.fn(); root.addEventListener("touchstart", handler);
    const event = touch(0); root.dispatchEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.cancelBubble).toBe(false);
  });

  it("비설치 환경은 리스너를 추가하지 않고 언마운트 시 정확히 정리", () => {
    const root = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as EventTarget;
    installEdgeBackGuard(root, { ...iphone, standalone: false })();
    expect(root.addEventListener).not.toHaveBeenCalled();
    const cleanup = installEdgeBackGuard(root, iphone);
    const listener = vi.mocked(root.addEventListener).mock.calls[0][1];
    expect(root.addEventListener).toHaveBeenCalledWith("touchstart", listener, { capture: true, passive: false });
    cleanup();
    expect(root.removeEventListener).toHaveBeenCalledWith("touchstart", listener, { capture: true });
  });
});
