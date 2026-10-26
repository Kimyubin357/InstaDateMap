export const NEW_PLACE_WINDOW = 24 * 60 * 60 * 1000;
/** Only the original registration date counts; duplicate saves and restores don't reset it. */
export function isNewPlace(createdAt: string, now: number) {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created <= now && now < created + NEW_PLACE_WINDOW;
}
