import { describe, expect, it } from "vitest";
import { suggestedMemberNames } from "@/lib/member-names";

describe("예전 저장자에서 이름 제안", () => {
  it("익명·빈 값·잘못된 값은 추천하지 않고 실제 이름만 제안", () => {
    expect(suggestedMemberNames(["익명", " Anonymous ", null, "", " ", "x".repeat(21), " 유빈 ", "유빈", "준호", "다른 사람"])).toEqual(["유빈", "준호"]);
    expect(suggestedMemberNames(["익명", "unknown"])).toEqual([]);
  });
});
