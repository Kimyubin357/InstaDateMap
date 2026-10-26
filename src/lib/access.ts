import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "./db";
import { AccessError, boardFromRequest, cookieValue, safeNext, SESSION_COOKIE, SETUP_COOKIE } from "./auth";
import { newToken, tokenHash } from "./pin";

export const sessionExpiry = (remember: boolean) => new Date(Date.now() + (remember ? 90 * 86400 : 12 * 3600) * 1000).toISOString();
export async function defaultBoard() {
  let query = db().from("boards").select("id, name, pin_hash, member_names, auth_version");
  if (process.env.APP_BOARD_ID) query = query.eq("id", process.env.APP_BOARD_ID);
  const { data, error } = await query.order("created_at").limit(2);
  if (error) { console.error("defaultBoard: board query failed", error.code, error.message); throw new Error("지도 정보를 읽지 못했어요. 잠시 후 다시 시도해 주세요."); }
  if (!data?.length || data.length > 1) {
    console.error(`defaultBoard: expected exactly one board, found ${data?.length ?? 0}. Set APP_BOARD_ID.`);
    throw new Error("지금은 지도를 열 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
  return data[0];
}
export async function setupSession(req: Request) {
  const token = cookieValue(req, SETUP_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new AccessError("처음 받은 지도 주소로 PIN 설정을 열어 주세요.", 401);
  const { data, error } = await db().from("access_sessions").select("*").eq("token_hash", tokenHash(token)).maybeSingle();
  if (error) throw new Error("설정 상태를 확인하지 못했어요.");
  if (!data || data.purpose !== "setup" || new Date(data.expires_at).getTime() <= Date.now()) throw new AccessError("설정 시간이 만료됐어요. 처음 받은 주소로 다시 열어 주세요.", 401);
  return data;
}
export async function createSession(boardId: string, version: number, remember: boolean, purpose = "member") {
  const token = newToken();
  const { error } = await db().from("access_sessions").insert({ token_hash: tokenHash(token), board_id: boardId, purpose,
    auth_version: version, remember, expires_at: purpose === "setup" ? new Date(Date.now() + 600000).toISOString() : sessionExpiry(remember) });
  if (error) throw new Error("이 기기에 입장 상태를 저장하지 못했어요.");
  return token;
}
export function setSessionCookie(response: NextResponse, token: string, remember: boolean, setup = false) {
  response.cookies.set(setup ? SETUP_COOKIE : SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", ...(setup ? { maxAge: 600 } : remember ? { maxAge: 90 * 86400 } : {}) });
  return response;
}
export async function pageRequest() {
  return new Request("http://localhost/", { headers: { cookie: (await cookies()).toString() } });
}
export async function requirePageBoard(next = "/", identity = true) {
  const board = await boardFromRequest(await pageRequest());
  if (!board) redirect(`/enter?next=${encodeURIComponent(safeNext(next))}`);
  if (identity && !board.who) redirect(`/choose?next=${encodeURIComponent(safeNext(next))}`);
  return board;
}
export function legacyRedirect(token: string | undefined, next: string) {
  if (token) redirect(`/api/access/bootstrap?t=${encodeURIComponent(token)}&next=${encodeURIComponent(safeNext(next))}`);
}
export async function reserveAttempt(boardId: string, req: Request) {
  const ip = (process.env.VERCEL ? req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for") : req.headers.get("x-forwarded-for"))?.split(",")[0]?.trim() || "local";
  const key = tokenHash(`${boardId}:${ip}`);
  const { data, error } = await db().rpc("dm_reserve_attempt", { p_board: boardId, p_ip: key });
  if (error) throw new Error("입장 시도 횟수를 확인하지 못했어요.");
  if (data > 0) throw new AccessError(`잠시 쉬었다가 다시 열어 주세요. 약 ${Math.ceil(data / 60)}분 후에 시도할 수 있어요.`, 429, data);
  return key;
}
export async function clearAttempt(boardId: string, ip: string) {
  const { error } = await db().rpc("dm_clear_attempt", { p_board: boardId, p_ip: ip });
  if (error) throw new Error("입장 상태를 갱신하지 못했어요.");
}
