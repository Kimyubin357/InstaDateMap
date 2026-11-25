import { describe, expect, it } from "vitest";
import { actorName, placePeople } from "@/lib/people";

const members = [{ userId: "u1", name: "유빈이" }, { userId: "u2", name: "수민" }];
describe("기록한 사람의 보여 줄 이름(019)", () => {
  it("지금 방 멤버면 지금 이름, 아니면(나감·탈퇴·예전 기록) 기록된 이름", () => {
    expect(actorName(members, "u1", "유빈")).toBe("유빈이");
    expect(actorName(members, "u9", "떠난 사람")).toBe("떠난 사람");
    expect(actorName(members, null, "옛이름")).toBe("옛이름");
  });
  it("같은 계정의 기록은 이름이 달라도 한 사람으로 세고, 처음 등록한 사람은 가장 이른 기록", () => {
    const people = placePeople([
      { added_by: "유빈이", added_by_user_id: "u1", added_at: "2026-02-01" },
      { added_by: "수민", added_by_user_id: "u2", added_at: "2026-01-15" },
      { added_by: "유빈", added_by_user_id: "u1", added_at: "2026-01-01" },
      { added_by: "옛이름", added_by_user_id: null },
    ], members);
    expect(people).toEqual({ sharers: ["유빈이", "수민", "옛이름"], registrant: "유빈이", registrant_id: "u1" });
    expect(placePeople([], members)).toEqual({ sharers: [], registrant: null, registrant_id: null });
  });
});
