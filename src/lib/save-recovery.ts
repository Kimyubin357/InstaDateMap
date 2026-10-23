import { requestJson, RequestError } from "./client-request";
import { UnconfirmedWriteError } from "./verified-write";
import type { ShareResult } from "./share-stream";
import type { PlaceStatus } from "./types";

export async function verifyPlacePatch<T extends { memo?: string; status?: PlaceStatus }>(id: string, patch: T): Promise<T | null> {
  const { place } = await requestJson<{ place: { memo: string | null; status: PlaceStatus } }>(`/api/places/${id}`, { cache: "no-store" });
  return Object.entries(patch).every(([key, value]) => (key === "memo" ? place.memo || "" : place.status) === value) ? patch : null;
}
export async function verifyDeletedPlace(id: string): Promise<{ ok: boolean; deleted_id: string } | null> {
  try { await requestJson(`/api/places/${id}`, { cache: "no-store" }); return null; }
  catch (error) { if (error instanceof RequestError && error.status === 404 && error.code === "PLACE_NOT_FOUND") return { ok: true, deleted_id: id }; throw error; }
}
interface SaveStatus {
  result: ShareResult | null;
  source: { id: string; status: string } | null;
  selections: { id: string; excluded: boolean }[];
  linked: { kakao_place_id: string; extraction_id: string | null }[];
}
const readStatus = (params: Record<string, string>) => requestJson<SaveStatus>(`/api/save-status?${new URLSearchParams(params)}`, { cache: "no-store" });
export async function verifyDirectSave(kakaoId: string, sourceId?: string): Promise<ShareResult | null> {
  const current = await readStatus(sourceId ? { source_id: sourceId } : { kakao_place_id: kakaoId });
  if (current.source?.status === "processing") throw new UnconfirmedWriteError("아직 링크를 처리하고 있어요. 잠시 후 저장 여부를 다시 확인해 주세요.");
  if (sourceId && (current.source?.status !== "done" || !current.linked.some((p) => p.kakao_place_id === kakaoId))) return null;
  return current.result?.status === "saved" ? current.result : null;
}
export type ConfirmChoice = { extraction_id: string; include: boolean; place: { kakao_place_id: string } | null };
export type ConfirmSaved = { saved: number; place_url?: string; saved_place?: ShareResult["saved_place"] };
export async function verifyConfirmation(sourceId: string, choices: ConfirmChoice[]): Promise<ConfirmSaved | null> {
  const current = await readStatus({ source_id: sourceId });
  if (current.source?.status === "processing") throw new UnconfirmedWriteError("아직 링크를 처리하고 있어요. 잠시 후 다시 확인해 주세요.");
  if (current.source?.status !== "done" || !choices.every((choice) => {
    const keep = choice.include && !!choice.place;
    return current.selections.some((s) => s.id === choice.extraction_id && s.excluded === !keep)
      && (!keep || current.linked.some((p) => p.extraction_id === choice.extraction_id && p.kakao_place_id === choice.place!.kakao_place_id));
  })) return null;
  const saved = choices.filter((c) => c.include && c.place).length;
  if (saved && current.result?.status !== "saved") return null;
  return { saved, place_url: current.result?.place_url, saved_place: current.result?.saved_place };
}
export async function verifySharedLink(url: string, retryAfter = Infinity): Promise<ShareResult | null> {
  const current = await readStatus({ url });
  if (current.source?.status === "processing") {
    // A deliberate retry may restart after the original route's 60s execution window.
    // Returning null never re-sends automatically; VerifiedWrite requires another user action.
    if (Date.now() >= retryAfter) return null;
    throw new UnconfirmedWriteError("아직 링크를 처리하고 있어요. 잠시 후 다시 확인해 주세요.");
  }
  return current.result;
}
