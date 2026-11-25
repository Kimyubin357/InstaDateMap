import { describe, expect, it } from "vitest";
import { collectionEmoji, duplicateNote, isCollectionIcon, isSingleEmoji, lastEmoji } from "@/lib/palette";
import { folderInput } from "@/lib/folders";
import { EMOJI_CATEGORIES, FREQUENT_EMOJI, searchEmoji } from "@/lib/emoji";

const others = [
  { id: "a", name: "기념일 저녁", color: "plum", icon: "🍷" },
  { id: "b", name: "성수 카페", color: "teal", icon: "cup" }, // 018 이전 키는 ☕로 본다
];
describe("모음 표지: 색 + 이모지", () => {
  it("이모지 하나만 받고, 예전 선 아이콘 키는 비슷한 이모지로 보여 준다", () => {
    expect(["☕", "🏖️", "👩‍❤️‍👨", "🇰🇷", "1️⃣", "👍🏽"].every(isSingleEmoji)).toBe(true);
    expect(["☕☕", "가", "a", "", " ☕", "<b>"].some(isSingleEmoji)).toBe(false);
    expect(isCollectionIcon("heart")).toBe(true);
    expect(collectionEmoji("heart")).toBe("💞"); expect(collectionEmoji("culture")).toBe("🎨"); expect(collectionEmoji("🍊")).toBe("🍊");
    expect(lastEmoji("커피☕ 그리고 🍰")).toBe("🍰"); expect(lastEmoji("커피")).toBeNull();
  });
  it("같은 방 모음끼리 색·이모지가 겹치면 회색 한 줄 안내를 만든다(자기 자신은 빼고)", () => {
    expect(duplicateNote({ id: "new", color: "plum", icon: "🌿" }, others)).toBe("‘기념일 저녁’ 모음도 이 색을 써요.");
    // 색과 이모지가 서로 다른 모음과 겹치면 이모지 쪽을 한 줄로 알린다
    expect(duplicateNote({ id: "new", color: "plum", icon: "☕" }, others)).toBe("‘성수 카페’ 모음도 이 이모지(☕)를 써요.");
    expect(duplicateNote({ id: "new", color: "red", icon: "🍷" }, others)).toBe("‘기념일 저녁’ 모음도 이 이모지(🍷)를 써요.");
    expect(duplicateNote({ id: "new", color: "plum", icon: "🍷" }, others)).toBe("‘기념일 저녁’ 모음도 이 색과 이 이모지(🍷)를 써요.");
    expect(duplicateNote({ id: "new", color: "teal", icon: "☕" }, others)).toBe("‘성수 카페’ 모음도 이 색과 이 이모지(☕)를 써요.");
    expect(duplicateNote({ id: "new", color: "red", icon: "🌿" }, others)).toBe("");
    expect(duplicateNote({ id: "a", color: "plum", icon: "🍷" }, others)).toBe("");
  });
  it("자주 쓰는 이모지 14개, 여섯 묶음, 한국어 낱말로 찾기", () => {
    expect(FREQUENT_EMOJI).toHaveLength(14);
    expect(EMOJI_CATEGORIES.map((c) => c.label)).toEqual(["음식", "카페", "여행", "놀거리", "자연", "마음"]);
    expect(EMOJI_CATEGORIES.flatMap((c) => c.items.map(([e]) => e)).every(isSingleEmoji)).toBe(true);
    expect(searchEmoji("커피")).toContain("☕"); expect(searchEmoji("바다")).toEqual(expect.arrayContaining(["🏖️", "🌊"]));
    expect(searchEmoji("")).toEqual([]);
  });
});
describe("방: 이름 + 색만", () => {
  it("10가지 색을 받고 아이콘은 무시한다", () => {
    expect(folderInput({ name: "친구들 맛집", color: "navy", icon: "map" })).toEqual({ name: "친구들 맛집", color: "navy" });
    expect(folderInput({ name: "x", color: "purple" })).toBe("방 색을 골라 주세요.");
    expect(folderInput({ name: " ", color: "red" })).toMatch(/1~30자/);
  });
});
