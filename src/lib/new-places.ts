import type { PlaceStatus } from "./types";
export const NEW_PLACE_WINDOW = 24 * 60 * 60 * 1000;
/** Only the original registration date counts; duplicate saves and restores don't reset it.
 *  A place stays NEW only while it is still "가고 싶음": marking it visited/again/meh ends NEW. */
export function isNewPlace(createdAt: string, now: number, status: PlaceStatus = "wish") {
  if (status !== "wish") return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created <= now && now < created + NEW_PLACE_WINDOW;
}
