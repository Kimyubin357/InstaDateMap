import { db } from "./db";
import { tokenHash } from "./token";
import { AnalysisError } from "./analysis-issue";
import { roomWord } from "./room-word";
import type { Member } from "./people";

export const SESSION_COOKIE = "datemap_session";
/** 계정(카카오·구글) 로그인 세션으로 연 폴더. 2026-11-24에 PIN 입장을 없앴습니다. */
export interface Board { id: string; name: string; who: string; sessionHash: string; remember: boolean; memberNames: string[]; authVersion: number; expiresAt: string; userId: string;
  /** 지금 이 방 멤버(계정 id와 지금 이름). 기록의 "누가"를 지금 이름으로 보여 줄 때 씁니다(019, src/lib/people.ts). */
  members: Member[] }
export function cookieValue(req: Request, name: string) {
  return req.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
export class AccessError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}
export function checkOrigin(req: Request) {
  if (!["GET", "HEAD"].includes(req.method) && req.headers.get("origin") !== new URL(req.url).origin) throw new AccessError("다른 사이트에서는 요청할 수 없어요.", 403);
}
const GENERIC_MESSAGE = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
/** Only messages written for users reach the client; library, DB and network errors are logged instead. */
export function publicMessage(e: unknown, fallback = GENERIC_MESSAGE) {
  if (e instanceof AccessError || e instanceof AnalysisError) return roomWord(e.message);
  if (e instanceof Error && e.constructor === Error && /[가-힣]/.test(e.message)) return roomWord(e.message);
  console.error("Unhandled server error", e);
  return fallback;
}
/** A DB function's own `raise exception` (P0001) with a Korean message is meant for users. */
export function dbUserError(error: { message: string; code?: string } | null) {
  return error?.code === "P0001" && /[가-힣]/.test(error.message) ? new AccessError(roomWord(error.message), 409) : null;
}
export function accessError(e: unknown) {
  return Response.json({ status: "error", message: publicMessage(e) },
    { status: e instanceof AccessError ? e.status : 500, headers: { "Cache-Control": "no-store", ...(e instanceof AccessError && e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
}
/** 만료되지 않은 계정 세션 한 줄. 폴더가 없는 세션은 board_id가 null입니다. 예전 PIN 세션(user_id 없음)은 열지 않습니다. */
async function sessionFromRequest(req: Request) {
  checkOrigin(req);
  const token = cookieValue(req, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: session, error } = await db().from("access_sessions").select("*").eq("token_hash", tokenHash(token)).maybeSingle();
  if (error) { console.error("boardFromRequest: session query failed", error.code, error.message); throw new Error("입장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."); }
  if (!session || !session.user_id || session.purpose !== "member" || new Date(session.expires_at).getTime() <= Date.now()) return null;
  return session;
}
export interface Account { userId: string; sessionHash: string; boardId: string | null; remember: boolean; expiresAt: string }
/** 카카오·구글 로그인 세션. 폴더가 0개여도 로그인 상태입니다. */
export async function accountFromRequest(req: Request): Promise<Account | null> {
  const session = await sessionFromRequest(req);
  if (!session) return null;
  return { userId: session.user_id, sessionHash: session.token_hash, boardId: session.board_id ?? null, remember: session.remember, expiresAt: session.expires_at };
}
/**
 * 요청한 방(`?room=`): 전체 보기에서 다른 방의 장소를 고칠 때 씁니다(2026-11-25 방 고르기·전체 보기).
 * 형식이 틀리면 없는 것으로 보고 이 기기가 연 방을 씁니다. 멤버 확인은 boardFromRequest가 계정 id로 합니다.
 */
export function requestedRoom(req: Request): string | undefined {
  const room = new URL(req.url).searchParams.get("room");
  return room && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(room) ? room : undefined;
}
/**
 * 이 기기가 연 방(세션의 board_id), 또는 `room`으로 고른 다른 방.
 * 다른 방은 그 방 멤버(계정 id)일 때만 열립니다. 세션의 인증 버전은 세션이 연 방에만 해당해 다른 방에는 비교하지 않습니다.
 */
export async function boardFromRequest(req: Request, room?: string | null): Promise<Board | null> {
  const session = await sessionFromRequest(req);
  const override = !!room && room !== session?.board_id;
  const boardId = override ? room : session?.board_id;
  if (!session || !boardId) return null;
  const { data: board, error: boardError } = await db().from("boards").select("id, name, member_names, auth_version").eq("id", boardId).maybeSingle();
  if (boardError) { console.error("boardFromRequest: board query failed", boardError.code, boardError.message); throw new Error("지도에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."); }
  // 다른 방을 찾지 못하거나 멤버가 아니면 로그인 문제가 아니라 없는 방으로 답합니다(로그아웃되지 않게).
  if (!board && override) throw new AccessError("방을 찾을 수 없어요.", 404);
  if (!board || (!override && board.auth_version !== session.auth_version)) return null;
  // 폴더 멤버일 때만 열립니다. 이름은 멤버 기록의 이름을 사용합니다.
  const { data: members, error: memberError } = await db().from("board_members").select("user_id, member_name, joined_at").eq("board_id", board.id).order("joined_at");
  if (memberError) { console.error("boardFromRequest: member query failed", memberError.code, memberError.message); throw new Error("지도에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."); }
  const me = members?.find((m) => m.user_id === session.user_id);
  if (!me && override) throw new AccessError("방을 찾을 수 없어요.", 404);
  if (!me) return null;
  const memberNames = [...new Set([...(board.member_names ?? []), ...(members ?? []).map((m) => m.member_name as string)])];
  return { id: board.id, name: board.name, who: me.member_name, sessionHash: session.token_hash, remember: session.remember,
    memberNames, authVersion: board.auth_version, expiresAt: session.expires_at, userId: session.user_id,
    members: (members ?? []).map((m) => ({ userId: m.user_id as string, name: m.member_name as string })) };
}
export function requireIdentity(board: Board) {
  if (!board.who) throw new AccessError("이 기기에서 사용할 이름을 먼저 골라 주세요.", 409);
}
export function unauthorized() { return Response.json({ status: "error", message: "다시 로그인해 주세요." }, { status: 401 }); }
export function safeNext(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "https://datemap.local");
    if (!["/", "/add", "/settings", "/settings/trash", "/settings/profile", "/settings/notifications", "/search", "/folders"].includes(url.pathname) && !/^\/confirm\/[a-f0-9-]+$/.test(url.pathname) && !/^\/invite\/[0-9a-f]{64}$/.test(url.pathname)) return "/";
    for (const key of ["t", "who", "next"]) url.searchParams.delete(key);
    return url.pathname + url.search;
  } catch { return "/"; }
}
