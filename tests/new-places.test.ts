import { expect, it } from "vitest";
import { isNewPlace, NEW_PLACE_WINDOW } from "@/lib/new-places";
it("등록 시각부터 24시간만 NEW이며 미래·손상된 날짜는 표시하지 않음", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  expect(isNewPlace(new Date(now).toISOString(), now)).toBe(true);
  expect(isNewPlace(new Date(now - NEW_PLACE_WINDOW + 1).toISOString(), now)).toBe(true);
  expect(isNewPlace(new Date(now - NEW_PLACE_WINDOW).toISOString(), now)).toBe(false);
  expect(isNewPlace(new Date(now + 1).toISOString(), now)).toBe(false);
  expect(isNewPlace("broken", now)).toBe(false);
});
it("가고 싶음일 때만 NEW이고 다녀옴·또 갈래·별로로 바꾸면 NEW가 빠짐", () => {
  const now = Date.parse("2026-10-26T12:00:00Z"), created = new Date(now - 1000).toISOString();
  expect(isNewPlace(created, now, "wish")).toBe(true);
  expect(isNewPlace(created, now, "visited")).toBe(false);
  expect(isNewPlace(created, now, "again")).toBe(false);
  expect(isNewPlace(created, now, "meh")).toBe(false);
});
