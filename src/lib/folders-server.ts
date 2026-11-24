import { db } from "./db";
import { AccessError, accountFromRequest, dbUserError, type Account } from "./auth";
import { isInviteToken, isUuid, type FolderDetail, type FolderSummary, type InvitePreview } from "./folders";
import { tokenHash } from "./token";

/** 폴더 API는 카카오·구글 계정 세션만 씁니다. */
export async function requireAccount(req: Request): Promise<Account> {
  const account = await accountFromRequest(req);
  if (!account) throw new AccessError("다시 로그인해 주세요.", 401);
  return account;
}

/** DB 함수의 한국어 안내는 그대로, 그 밖의 오류는 로그에만 남깁니다. */
export async function folderRpc<T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await db().rpc(name, params);
  const userError = dbUserError(error);
  if (userError) throw userError;
  if (error) { console.error(`${name} failed`, error.code, error.message); throw new Error(fallback); }
  return data as T;
}

export async function listFolders(userId: string) {
  return (await folderRpc<FolderSummary[]>("dm_list_folders", { p_user: userId }, "폴더 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")) ?? [];
}

export function folderId(value: string) {
  if (!isUuid(value)) throw new AccessError("폴더를 찾을 수 없어요.", 404);
  return value;
}

/** 참여한 폴더의 멤버와 진행 중인 초대 수. 참여하지 않은 폴더는 없는 폴더처럼 다룹니다. */
export async function folderDetail(account: Account, id: string): Promise<FolderDetail> {
  const folder = (await listFolders(account.userId)).find((f) => f.id === id);
  if (!folder) throw new AccessError("폴더를 찾을 수 없어요.", 404);
  const members = await folderRpc<{ user_id: string; member_name: string; role: "owner" | "member"; avatar: string | null }[]>("dm_folder_members", { p_board: id }, "폴더 멤버를 불러오지 못했어요.");
  let active = 0;
  if (folder.role === "owner") {
    const { data: invites, error: inviteError } = await db().from("folder_invites").select("id, expires_at, revoked_at").eq("board_id", id);
    if (inviteError) { console.error("folderDetail: invites failed", inviteError.code, inviteError.message); throw new Error("초대 링크 상태를 불러오지 못했어요."); }
    active = (invites ?? []).filter((i) => !i.revoked_at && new Date(i.expires_at).getTime() > Date.now()).length;
  }
  return { folder, active_invites: active,
    members: (members ?? []).map((m) => ({ user_id: m.user_id, name: m.member_name, role: m.role, me: m.user_id === account.userId, avatar: m.avatar ?? null })) };
}

/** 이 기기가 그 폴더를 열게 합니다(알림 구독은 폴더별이라 그대로, 017). */
export async function openFolder(account: Account, id: string) {
  await folderRpc("dm_switch_folder", { p_user: account.userId, p_session: account.sessionHash, p_board: id }, "폴더를 열지 못했어요. 잠시 후 다시 시도해 주세요.");
}

/** 삭제·나가기 뒤 이 기기가 보고 있는 폴더(없으면 null) */
export async function currentFolder(sessionHash: string): Promise<string | null> {
  const { data, error } = await db().from("access_sessions").select("board_id").eq("token_hash", sessionHash).maybeSingle();
  if (error) { console.error("currentFolder failed", error.code, error.message); throw new Error("지금 보는 폴더를 확인하지 못했어요."); }
  return data?.board_id ?? null;
}

export const noStore = { headers: { "Cache-Control": "no-store" } };

/** 초대 링크 미리보기(로그인 전에도 볼 수 있음). 잘못된 링크는 DB를 조회하지 않습니다. */
export async function invitePreview(token: string, userId: string | null): Promise<InvitePreview> {
  if (!isInviteToken(token)) return { code: "INVITE_INVALID" };
  return folderRpc<InvitePreview>("dm_invite_preview", { p_token_hash: tokenHash(token), p_user: userId }, "초대 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
}
