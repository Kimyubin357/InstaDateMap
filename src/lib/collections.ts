/** Shared wire types and validation. Membership is independent of a place's visit status. */
import { PALETTE_COLORS, isCollectionIcon, isPaletteColor, type PaletteColor } from "./palette";
/** 모음 색은 방과 같은 10가지. 표지는 이모지 하나(예전 선 아이콘 키도 읽기는 받음, 018). */
export const COLLECTION_COLORS = PALETTE_COLORS;
export interface CollectionView {
  id: string; name: string; description: string; color: PaletteColor;
  icon: string; version: number; created_at: string;
  place_ids: string[];
}
export type CollectionCommand =
  | { action: "create"; id: string; name: string; description: string; color: string; icon: string }
  | { action: "update"; id: string; version: number; name: string; description: string; color: string; icon: string }
  | { action: "delete"; id: string; version: number }
  | { action: "add" | "remove"; collection_ids: string[]; place_ids: string[] }
  | { action: "undo"; target: string };
export interface CollectionResult { ok: true; id?: string; changed?: number; operation_id: string }
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const collectionName = (v: string) => v.trim().replace(/\s+/g, " ");
export function validCollectionCommand(input: unknown): input is CollectionCommand {
  if (!input || typeof input !== "object") return false;
  const b = input as Record<string, unknown>;
  if (b.action === "undo") return isUuid(b.target);
  if (b.action === "add" || b.action === "remove") return [b.collection_ids, b.place_ids].every((x) => Array.isArray(x) && x.length > 0 && x.every(isUuid) && new Set(x).size === x.length) && (b.collection_ids as unknown[]).length <= 50 && (b.place_ids as unknown[]).length <= 200;
  if (!["create", "update", "delete"].includes(String(b.action)) || !isUuid(b.id)) return false;
  if (b.action !== "create" && (!Number.isSafeInteger(b.version) || Number(b.version) < 1 || Number(b.version) > 2147483647)) return false;
  if (b.action === "delete") return true;
  return typeof b.name === "string" && collectionName(b.name).length > 0 && collectionName(b.name).length <= 40 &&
    typeof b.description === "string" && b.description.length <= 120 && isPaletteColor(b.color) && isCollectionIcon(b.icon);
}
export function isCollection(value: unknown): value is CollectionView {
  if (!value || typeof value !== "object") return false;
  const c = value as CollectionView;
  return typeof c.id === "string" && typeof c.name === "string" && typeof c.description === "string" &&
    isPaletteColor(c.color) && isCollectionIcon(c.icon) && Number.isSafeInteger(c.version) && c.version >= 1 &&
    typeof c.created_at === "string" && Array.isArray(c.place_ids) && c.place_ids.every((id) => typeof id === "string");
}
