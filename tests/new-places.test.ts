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
