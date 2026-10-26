import { describe, expect, it, vi } from "vitest";
import { AccessError, accessError, dbUserError, publicMessage } from "@/lib/auth";
import { AnalysisError } from "@/lib/analysis-issue";
import { checkWork } from "@/lib/source-work";
import { friendlyMessage, RequestError } from "@/lib/client-request";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

describe("사용자에게 보내는 오류 문구", () => {
  it("직접 쓴 안내 문구는 그대로, 라이브러리·DB·네트워크 오류는 일반 문구로 바꾸고 서버 로그에만 남김", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicMessage(new AccessError("PIN이 맞지 않아요.", 401))).toBe("PIN이 맞지 않아요.");
    expect(publicMessage(new AnalysisError(Object.keys((await import("@/lib/analysis-issue")).ANALYSIS_MESSAGES)[0] as never))).toMatch(/[가-힣]/);
    expect(publicMessage(new Error("장소를 불러오지 못했어요."))).toBe("장소를 불러오지 못했어요.");
    expect(publicMessage(new TypeError("fetch failed"))).not.toContain("fetch");
    expect(publicMessage(new Error('invalid input syntax for type uuid: "x"'))).not.toContain("uuid");
    expect(publicMessage(new Error("Missing environment variable KAKAO_REST_API_KEY"))).not.toContain("KAKAO");
    const res = accessError(new Error("relation \"places\" does not exist"));
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain("relation");
    expect(log).toHaveBeenCalled(); log.mockRestore();
  });
  it("DB 함수의 한국어 raise만 409 안내로, 그 외 DB 오류는 숨김", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbUserError({ code: "P0001", message: "삭제한 장소에 있어요. 설정의 삭제한 장소에서 먼저 복구해 주세요." })).toMatchObject({ status: 409 });
    expect(dbUserError({ code: "P0001", message: "Invalid action" })).toBeNull();
    expect(dbUserError({ code: "22P02", message: "invalid input syntax for type uuid" })).toBeNull();
    expect(() => checkWork({ code: "22P02", message: 'invalid input syntax for type uuid: "x"' })).toThrow("링크 상태를 확인하지 못했어요");
    expect(() => checkWork({ code: "P0001", message: "SOURCE_STALE" })).toThrow(AccessError);
    log.mockRestore();
  });
});

describe("운영자용 안내와 브라우저 원문 오류는 화면에 보이지 않음", () => {
  it("화면에 나갈 수 있는 문구(로그 제외)에 DB·환경 변수·API 키 안내가 없음", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path); } };
    walk("src");
    const offenders = files.flatMap((file) => readFileSync(file, "utf8").split("\n").map((line, i) => ({ file, line: i + 1, text: line })))
      .filter(({ text }) => !/console\.(error|warn|log)/.test(text) && /["'`][^"'`]*(데이터베이스|APP_BOARD_ID로|환경 변수|API 키|REST API)[^"'`]*["'`]/.test(text));
    expect(offenders).toEqual([]);
  });
  it("브라우저 시간 초과·권한·연결 오류는 한국어 안내로 바꿈", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(friendlyMessage(new DOMException("signal timed out", "TimeoutError"), "대체")).toBe("응답이 늦어지고 있어요. 연결을 확인하고 다시 시도해 주세요.");
    expect(friendlyMessage(new DOMException("Registration failed - push service error", "AbortError"), "알림을 켜지 못했어요.")).toBe("알림을 켜지 못했어요.");
    expect(friendlyMessage(new TypeError("Failed to fetch"), "대체")).toBe("대체");
    expect(friendlyMessage(new RequestError("알림 설정을 저장하지 못했어요.", 503), "대체")).toBe("알림 설정을 저장하지 못했어요.");
    warn.mockRestore();
  });
});
