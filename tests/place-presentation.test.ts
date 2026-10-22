import { describe, expect, it } from "vitest";
import { categoryIcon, placeCopyContent } from "@/lib/place-presentation";

describe("장소 분류 표시와 복사", () => {
  it.each(["카페", "카페,디저트", "음식점 > 카페 > 커피전문점", "  카페  "])("새 검색과 저장된 %s에 같은 컵 아이콘을 사용", (category) => {
    expect(categoryIcon(category)).toBe("cup");
  });
  it.each([
    ["음식점", "food"], ["한식", "food"], ["관광명소", "tree"], ["문화시설", "culture"],
    ["숙박", "bed"], ["쇼핑 > 백화점", "bag"], ["스포츠,레저", "activity"],
    ["분류 미상", "pin"], [null, "pin"], ["", "pin"],
  ])("%s 분류를 식당으로 잘못 표시하지 않음", (category, icon) => {
    expect(categoryIcon(category)).toBe(icon);
  });
  it("주소가 있으면 주소를 복사하고 주소 복사라고 안내", () => {
    expect(placeCopyContent({ name: "카페", address: "  경기 수원시  " })).toEqual({ text: "경기 수원시", label: "주소", object: "주소를" });
  });
  it.each([null, "", "   "])("주소가 %s이면 장소명을 복사한다고 안내", (address) => {
    expect(placeCopyContent({ name: "주소 없는 장소", address })).toEqual({ text: "주소 없는 장소", label: "장소명", object: "장소명을" });
  });
});
