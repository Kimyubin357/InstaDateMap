import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  COACH_STEPS, EXAMPLE_COLLECTIONS, ONBOARDING_REPLAY_EVENT, ONBOARDING_STEPS, coachNumber, fetchOnboarded, markOnboarded, needsServerMark,
  onboardingKey, parseInvite, readLocalOnboarded, requestOnboardingReplay, shouldShowOnboarding, takeOnboardingReplay, welcomeTitle, writeLocalOnboarded,
} from "@/lib/onboarding";
// 처음 사용법(온보딩): 언제 보여 줄지, 021이 없을 때 이 기기 기록으로 대신하기, 다시 보기, 초대 환영 문구.

const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("보여 줄지", () => {
  it("서버가 '봤음'이면 안 보이고, 아직이거나 모르면 이 기기 기록으로 판단한다", () => {
    expect(shouldShowOnboarding(true, false)).toBe(false);
    expect(shouldShowOnboarding(false, false)).toBe(true);
    expect(shouldShowOnboarding(false, true)).toBe(false);
    // 021 미적용(모름): 이 기기에서 본 적이 없을 때만
    expect(shouldShowOnboarding(null, false)).toBe(true);
    expect(shouldShowOnboarding(null, true)).toBe(false);
  });
  it("이 기기에서만 본 기록이 있고 서버가 '아직'이면 서버에 다시 적는다(모를 때는 적지 않음)", () => {
    expect(needsServerMark(false, true)).toBe(true);
    expect(needsServerMark(null, true)).toBe(false);
    expect(needsServerMark(true, true)).toBe(false);
    expect(needsServerMark(false, false)).toBe(false);
  });
});

describe("이 기기 기록", () => {
  it("계정마다 따로 적고 읽는다", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    expect(readLocalOnboarded("u1", storage)).toBe(false);
    writeLocalOnboarded("u1", storage);
    expect(readLocalOnboarded("u1", storage)).toBe(true);
    expect(readLocalOnboarded("u2", storage)).toBe(false);
    expect([...data.keys()]).toEqual([onboardingKey("u1")]);
  });
  it("저장소를 못 쓰면(사생활 보호 모드 등) 멈추지 않고 '안 봄'으로 본다", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readLocalOnboarded("u1", broken)).toBe(false);
    expect(() => writeLocalOnboarded("u1", broken)).not.toThrow();
    expect(readLocalOnboarded("u1", null)).toBe(false);
  });
});

describe("서버 기록 요청", () => {
  it("true/false만 믿고, 실패·로그인 만료·이상한 답은 모름(null)", async () => {
    expect(await fetchOnboarded(json(200, { onboarded: true }))).toBe(true);
    expect(await fetchOnboarded(json(200, { onboarded: false }))).toBe(false);
    expect(await fetchOnboarded(json(200, { onboarded: null }))).toBeNull();
    expect(await fetchOnboarded(json(401, { error: "다시 로그인해 주세요." }))).toBeNull();
    expect(await fetchOnboarded(json(200, "oops"))).toBeNull();
    expect(await fetchOnboarded(async () => { throw new TypeError("offline"); })).toBeNull();
  });
  it("봤음 적기: POST로 보내고, 저장됐을 때만 true", async () => {
    const fetcher = vi.fn(json(200, { ok: true, stored: true }));
    expect(await markOnboarded(fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/onboarding", expect.objectContaining({ method: "POST" }));
    expect(await markOnboarded(json(200, { ok: true, stored: false }))).toBe(false);
    expect(await markOnboarded(json(500, {}))).toBe(false);
    expect(await markOnboarded(async () => { throw new TypeError("offline"); })).toBe(false);
  });
});

describe("흐름", () => {
  it("환영 → 코치마크 5장(n / 5) → 마무리", () => {
    expect(ONBOARDING_STEPS).toEqual(["welcome", "copy", "plus", "room", "collections", "invite", "finish"]);
    expect(COACH_STEPS.map(coachNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(coachNumber("welcome")).toBe(0);
  });
  it("설정 → 사용법 다시 보기는 한 번만 꺼내 쓰고, 지도에 알린다", () => {
    const target = new EventTarget(); vi.stubGlobal("window", target);
    const heard = vi.fn();
    target.addEventListener(ONBOARDING_REPLAY_EVENT, heard);
    requestOnboardingReplay();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(takeOnboardingReplay()).toBe(true);
    expect(takeOnboardingReplay()).toBe(false);
    vi.unstubAllGlobals();
  });
  it("초대로 들어온 사람은 방장 이름(없으면 방 이름)으로 환영한다", () => {
    expect(welcomeTitle(null)).toEqual({ lead: "인스타에서 본 곳,", em: "지도에 모아요" });
    expect(welcomeTitle(parseInvite(JSON.stringify({ owner: "유빈", room: "우리 데이트맵" })))).toEqual({ lead: "유빈님의 방에", em: "들어왔어요" });
    expect(welcomeTitle(parseInvite(JSON.stringify({ owner: null, room: "제주 여행" })))).toEqual({ lead: "‘제주 여행’ 방에", em: "들어왔어요" });
    expect(parseInvite(JSON.stringify({ owner: " ", room: 3 }))).toBeNull();
    expect(parseInvite("{broken")).toBeNull();
    expect(parseInvite(null)).toBeNull();
  });
  it("예시 모음은 첫날·둘째날·셋째날", () => {
    expect(EXAMPLE_COLLECTIONS.map((c) => `${c.icon} ${c.name}`)).toEqual(["✈️ 첫날", "🌊 둘째날", "🍊 셋째날"]);
  });
});

describe("화면 문구", () => {
  it("온보딩·설정 문구에 '폴더'를 쓰지 않는다", () => {
    for (const file of ["src/components/Onboarding.tsx", "src/lib/onboarding.ts", "src/app/settings/SettingsForm.tsx"]) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, file).not.toContain("폴더");
    }
  });
});
