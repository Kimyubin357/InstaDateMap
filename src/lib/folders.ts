import { COLLECTION_COLORS, COLLECTION_ICONS } from "./collections";

/** 폴더 표지는 모음과 같은 색·아이콘 체계를 씁니다. */
export const FOLDER_COLORS = COLLECTION_COLORS;
export const FOLDER_ICONS = COLLECTION_ICONS;
export type FolderColor = typeof FOLDER_COLORS[number];
export type FolderIcon = typeof FOLDER_ICONS[number];
export const FOLDER_COLOR_LABEL: Record<FolderColor, string> = { red: "빨강", forest: "초록", gold: "겨자", blue: "파랑" };
export const FOLDER_ICON_LABEL: Record<FolderIcon, string> = { heart: "하트", map: "지도", cup: "카페", food: "맛집", tree: "자연", culture: "문화" };
export const INVITE_DAYS = 7;

export interface FolderSummary { id: string; name: string; color: FolderColor; icon: FolderIcon; role: "owner" | "member"; member_name: string; member_count: number; member_limit: number; place_count: number }
export interface FolderMember { user_id: string; name: string; role: "owner" | "member"; me: boolean }
export interface FolderDetail { folder: FolderSummary; members: FolderMember[]; active_invites: number }
export interface FoldersResponse { folders: FolderSummary[]; current: string | null }
export interface InvitePreview { code: "OK" | "ALREADY_MEMBER" | "FOLDER_FULL" | "INVITE_INVALID"; board_id?: string; name?: string; color?: FolderColor; icon?: FolderIcon; owner?: string | null; member_count?: number; member_limit?: number; expires_at?: string }

export interface FolderInput { name: string; color: FolderColor; icon: FolderIcon }
/** 이름은 DB에서도 다시 검사합니다. 여기서는 형식만 걸러 한국어 안내를 줍니다. */
export function folderInput(body: unknown): FolderInput | string {
  const b = body as Partial<Record<keyof FolderInput, unknown>> | null;
  const name = typeof b?.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 30) return "폴더 이름을 1~30자로 입력해 주세요.";
  if (!FOLDER_COLORS.includes(b?.color as FolderColor)) return "폴더 색을 골라 주세요.";
  if (!FOLDER_ICONS.includes(b?.icon as FolderIcon)) return "폴더 아이콘을 골라 주세요.";
  return { name, color: b!.color as FolderColor, icon: b!.icon as FolderIcon };
}
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isInviteToken = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
