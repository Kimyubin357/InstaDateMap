import { PALETTE_COLORS, PALETTE_LABEL, isPaletteColor, type PaletteColor } from "./palette";

/** 방은 이름과 색만 정합니다(2026-11-25 사용자 결정). DB의 boards.icon은 남아 있지만 쓰지 않습니다. */
export const FOLDER_COLORS = PALETTE_COLORS;
export type FolderColor = PaletteColor;
export const FOLDER_COLOR_LABEL = PALETTE_LABEL;
export const INVITE_DAYS = 7;
/** 한 계정이 만들거나 들어갈 수 있는 방 수(018). 이미 넘긴 계정은 그대로 두고 더 늘리지만 못 합니다. */
export const ROOM_LIMIT = 10;
/** 방 이름 글자 수(DB dm_folder_name) */
export const ROOM_NAME_MAX = 30;

export interface FolderSummary { id: string; name: string; color: FolderColor; role: "owner" | "member"; member_name: string; member_count: number; member_limit: number; place_count: number }
export interface FolderMember { user_id: string; name: string; role: "owner" | "member"; me: boolean; avatar?: string | null }
export interface FolderDetail { folder: FolderSummary; members: FolderMember[]; active_invites: number }
export interface FoldersResponse { folders: FolderSummary[]; current: string | null }
export interface InvitePreview { code: "OK" | "ALREADY_MEMBER" | "FOLDER_FULL" | "INVITE_INVALID"; board_id?: string; name?: string; color?: FolderColor; owner?: string | null; member_count?: number; member_limit?: number; expires_at?: string }

export interface FolderInput { name: string; color: FolderColor }
/** 이름은 DB에서도 다시 검사합니다. 여기서는 형식만 걸러 한국어 안내를 줍니다. 아이콘은 받지 않습니다(보내도 무시). */
export function folderInput(body: unknown): FolderInput | string {
  const b = body as Partial<Record<keyof FolderInput, unknown>> | null;
  const name = typeof b?.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > ROOM_NAME_MAX) return `방 이름을 1~${ROOM_NAME_MAX}자로 입력해 주세요.`;
  if (!isPaletteColor(b?.color)) return "방 색을 골라 주세요.";
  return { name, color: b!.color as FolderColor };
}
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isInviteToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
