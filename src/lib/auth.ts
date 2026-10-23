import { db } from "./db";
import { tokenHash } from "./pin";

export const SESSION_COOKIE = "datemap_session";
export const SETUP_COOKIE = "datemap_setup";
export interface Board { id: string; name: string; who: string; sessionHash: string; remember: boolean; memberNames: string[]; authVersion: number; expiresAt: string }
export function cookieValue(req: Request, name: string) {
  return req.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
export class AccessError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}
export function checkOrigin(req: Request) {
  if (!["GET", "HEAD"].includes(req.method) && req.headers.get("origin") !== new URL(req.url).origin) throw new AccessError("다른 사이트에서는 요청할 수 없어요.", 403);
}
export function accessError(e: unknown) {
  return Response.json({ status: "error", message: e instanceof Error ? e.message : "요청을 처리하지 못했어요." },
    { status: e instanceof AccessError ? e.status : 500, headers: { "Cache-Control": "no-store", ...(e instanceof AccessError && e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
}
export async function boardFromRequest(req: Request): Promise<Board | null> {
  checkOrigin(req);
  const token = cookieValue(req, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data: session, error } = await db().from("access_sessions").select("*").eq("token_hash", tokenHash(token)).maybeSingle();
  if (error) throw new Error("입장 상태를 확인하지 못했어요. 데이터베이스 연결을 확인해 주세요.");
  if (!session || session.purpose !== "member" || new Date(session.expires_at).getTime() <= Date.now()) return null;
  const { data: board, error: boardError } = await db().from("boards").select("id, name, member_names, auth_version").eq("id", session.board_id).maybeSingle();
  if (boardError) throw new Error("보드에 연결하지 못했어요. 데이터베이스 연결을 확인해 주세요.");
  if (!board || board.auth_version !== session.auth_version) return null;
  return { id: board.id, name: board.name, who: board.member_names.includes(session.member_name) ? session.member_name : "",
    sessionHash: session.token_hash, remember: session.remember, memberNames: board.member_names, authVersion: board.auth_version, expiresAt: session.expires_at };
}
export function requireIdentity(board: Board) {
  if (!board.who) throw new AccessError("이 기기에서 사용할 이름을 먼저 골라 주세요.", 409);
}
export function unauthorized() { return Response.json({ status: "error", message: "PIN으로 우리 지도를 다시 열어 주세요." }, { status: 401 }); }
export function safeNext(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "https://datemap.local");
    if (!["/", "/add", "/settings", "/settings/trash", "/search"].includes(url.pathname) && !/^\/confirm\/[a-f0-9-]+$/.test(url.pathname)) return "/";
    for (const key of ["t", "who", "next"]) url.searchParams.delete(key);
    return url.pathname + url.search;
  } catch { return "/"; }
}
