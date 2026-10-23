import type { PlaceView } from "./place-view";
export interface SyncAccess { boardId: string; authVersion: number; who: string; memberNames: string[]; kakaoKey: string; expiresAt: string }
export interface PendingSource { id: string; url: string; status: string; shared_by: string; analysis_version?: string; recovery_reason?: string | null }
export interface BoardSnapshot { boardId: string; authVersion: number; revision: string; board: string; places: PlaceView[]; pending: PendingSource[] }
export const cacheScope = (access: Pick<SyncAccess, "boardId" | "authVersion">) => `${access.boardId}:${access.authVersion}`;
export const SNAPSHOT_SCHEMA = 2;
export const snapshotEtag = (data: Pick<BoardSnapshot, "boardId" | "authVersion" | "revision">) => `"dm${SNAPSHOT_SCHEMA}:${data.boardId}:${data.authVersion}:${data.revision}"`;
export function isSnapshot(value: unknown): value is BoardSnapshot {
  const s = value as BoardSnapshot;
  return !!s && typeof s.boardId === "string" && Number.isInteger(s.authVersion) && typeof s.revision === "string" && /^\d+$/.test(s.revision) && typeof s.board === "string" &&
    Array.isArray(s.places) && s.places.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && (p.kakao_place_id === null || typeof p.kakao_place_id === "string") && Number.isFinite(p.lat) && Number.isFinite(p.lng) && ["wish", "again", "visited", "meh"].includes(p.status) && Array.isArray(p.sharers) && p.sharers.every((n) => typeof n === "string") && Array.isArray(p.sources) && p.sources.every((x) => typeof x?.url === "string" && typeof x.media_type === "string") && (p.memo == null || typeof p.memo === "string")) &&
    Array.isArray(s.pending) && s.pending.every((p) => p && [p.id, p.url, p.status, p.shared_by].every((v) => typeof v === "string"));
}
