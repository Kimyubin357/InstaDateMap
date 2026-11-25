/**
 * 이 기기에서만 기억하는 저장 기록(브라우저 저장소, DB 변경 없음).
 * - 마지막에 저장한 방: 방 고르기 시트의 '최근' 꼬리표와 /add 방 카드의 설명에 씁니다.
 *   실제 저장 대상은 지금 연 방(서버 세션)이고, 방을 바꾸면 그 방이 열려 다음 저장에도 그대로 쓰입니다.
 * - 방금 담은 장소: 저장 뒤 지도에서 '방금 담은 N곳' 시트를 한 번 띄웁니다.
 */
const LAST_ROOM = "datemap-last-saved-room";
const JUST_SAVED = "datemap-just-saved";
const JUST_SAVED_MS = 5 * 60 * 1000;

export function rememberSavedRoom(boardId?: string | null) {
  if (!boardId) return;
  try { localStorage.setItem(LAST_ROOM, boardId); } catch { /* 기억하지 못해도 저장은 끝났습니다. */ }
}
export function lastSavedRoom(): string | null {
  try { return localStorage.getItem(LAST_ROOM); } catch { return null; }
}

export interface JustSaved { boardId: string; ids: string[]; url: string | null; at: number }
export function rememberJustSaved(value: Omit<JustSaved, "at">, now = Date.now()) {
  if (!value.boardId || !value.ids.length) return;
  rememberSavedRoom(value.boardId);
  try { sessionStorage.setItem(JUST_SAVED, JSON.stringify({ ...value, at: now })); } catch { /* 시트만 생략됩니다. */ }
}
/** 한 번만 읽습니다. 다른 방이거나 오래된 기록은 버립니다. */
export function takeJustSaved(boardId: string, now = Date.now()): JustSaved | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(JUST_SAVED); sessionStorage.removeItem(JUST_SAVED); } catch { return null; }
  return parseJustSaved(raw, boardId, now);
}
export function parseJustSaved(raw: string | null, boardId: string, now = Date.now()): JustSaved | null {
  try {
    const value = JSON.parse(raw || "null") as JustSaved | null;
    if (!value || value.boardId !== boardId || !Array.isArray(value.ids) || !Number.isFinite(value.at) || now - value.at > JUST_SAVED_MS || now < value.at - 1000) return null;
    const ids = [...new Set(value.ids.filter((id) => typeof id === "string" && /^[a-z0-9-]+$/i.test(id)))];
    return ids.length ? { boardId, ids, url: typeof value.url === "string" && /^https:\/\/(www\.)?instagram\.com\//i.test(value.url) ? value.url : null, at: value.at } : null;
  } catch { return null; }
}
/** 저장 응답의 place_url(/?place=…)에서 장소 id */
export function placeIdFrom(placeUrl?: string) {
  try { const id = new URL(placeUrl || "/", "https://datemap.local").searchParams.get("place"); return id && /^[a-z0-9-]+$/i.test(id) ? id : null; } catch { return null; }
}
