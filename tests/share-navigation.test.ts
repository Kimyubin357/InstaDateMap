import { describe, expect, it } from "vitest";
import { savedMapHref, shareDestination } from "@/lib/share-navigation";

describe("중간 완료 화면 없이 다음 단계로 이동", () => {
  it("후보를 찾으면 토큰과 사용자 쿼리 없이 선택 화면을 바로 연다", () => {
    expect(shareDestination({ status: "confirm", message: "장소 2곳", confirm_url: "https://datemap.example/confirm/source-123?t=old&who=old" })).toBe("/confirm/source-123");
  });
  it("저장과 중복 결과는 상세 시트 대신 해당 장소가 보이는 지도로 이동", () => {
    for (const status of ["saved", "duplicate"]) {
      expect(shareDestination({ status, message: "완료", place_url: "/?place=place-123" })).toBe("/?saved=place-123" + (status === "duplicate" ? "&duplicate=1" : ""));
    }
    expect(savedMapHref()).toBe("/?saved=1");
  });
  it("분석 실패는 재시도 화면에 남기고 잘못된 주소로 이동하지 않는다", () => {
    for (const status of ["needs_caption", "needs_review", "error"]) {
      expect(shareDestination({ status, message: "보완 필요", confirm_url: "/confirm/source-123" })).toBeNull();
    }
    expect(shareDestination({ status: "confirm", message: "", confirm_url: "javascript:alert(1)" })).toBeNull();
    expect(savedMapHref("/?place=bad%2Fpath&t=old")).toBe("/?saved=1");
  });
});
