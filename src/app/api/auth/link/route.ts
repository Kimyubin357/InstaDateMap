import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AccessError, accessError, boardFromRequest, dbUserError, unauthorized } from "@/lib/auth";
import { clearAttempt, defaultBoard, reserveAttempt } from "@/lib/access";
import { verifyPin } from "@/lib/pin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 연결할 수 있는 기존 PIN 지도와, 아직 다른 계정이 쓰지 않은 이름 */
async function linkState(userId: string) {
  let legacy: Awaited<ReturnType<typeof defaultBoard>>;
  try { legacy = await defaultBoard(); } catch { return null; }
  const { data, error } = await db().from("board_members").select("user_id, member_name").eq("board_id", legacy.id);
  if (error) throw new Error("연결 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  const mine = data?.find((m) => m.user_id === userId);
  const taken = new Set((data ?? []).filter((m) => m.user_id !== userId).map((m) => m.member_name as string));
  return { legacy, linked: mine?.member_name as string | undefined, names: (legacy.member_names as string[]).filter((n) => !taken.has(n)) };
}

export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    if (!board.userId) throw new AccessError("계정으로 로그인한 뒤 연결해 주세요.", 409);
    const state = await linkState(board.userId);
    return NextResponse.json(state ? { available: true, linked: state.linked ?? null, names: state.names } : { available: false, linked: null, names: [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}

/** 기존 PIN과 이름 하나로 이 계정을 기존 지도의 멤버로 연결하고, 이 기기를 그 지도로 옮깁니다. */
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    if (!board.userId) throw new AccessError("계정으로 로그인한 뒤 연결해 주세요.", 409);
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name : "";
    const state = await linkState(board.userId);
    if (!state) throw new AccessError("연결할 수 있는 기존 지도가 없어요.", 404);
    if (!state.linked && !state.names.includes(name)) throw new AccessError("이 지도의 이름 중에서 골라 주세요.");
    const ip = await reserveAttempt(state.legacy.id, req);
    if (!await verifyPin(body?.pin, state.legacy.pin_hash)) throw new AccessError("PIN이 맞지 않아요. 둘만의 여섯 자리를 다시 확인해 주세요.", 401);
    await clearAttempt(state.legacy.id, ip);
    const { data, error } = await db().rpc("dm_link_member", { p_user: board.userId, p_board: state.legacy.id, p_name: state.linked ?? name });
    const userError = dbUserError(error);
    if (userError) throw userError;
    if (error || !data) { console.error("dm_link_member failed", error?.code, error?.message); throw new Error("지도를 연결하지 못했어요. 잠시 후 다시 시도해 주세요."); }
    const { error: moveError } = await db().from("access_sessions").update({ board_id: data.board_id, member_name: data.member_name, auth_version: data.auth_version }).eq("token_hash", board.sessionHash);
    if (moveError) throw new Error("지도는 연결했지만 이 기기에서 열지 못했어요. 다시 로그인해 주세요.");
    return NextResponse.json({ next: "/" });
  } catch (e) { return accessError(e); }
}
