import { NextResponse } from "next/server";
import { boardFromRequest, requireIdentity, unauthorized, accessError, AccessError } from "@/lib/auth";
import { reserveAttempt, clearAttempt, sessionExpiry, setSessionCookie } from "@/lib/access";
import { hashPin, verifyPin, validPin, newToken, tokenHash } from "@/lib/pin";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = await req.json().catch(() => null);
    if (!validPin(body?.newPin) || body.newPin !== body?.confirmPin) throw new AccessError("새 PIN을 숫자 6자리로 두 번 똑같이 입력해 주세요.");
    const ip = await reserveAttempt(board.id, req);
    const { data: stored, error: readError } = await db().from("boards").select("pin_hash").eq("id", board.id).single();
    if (readError) throw new Error("현재 PIN을 확인하지 못했어요.");
    if (!await verifyPin(body?.currentPin, stored.pin_hash)) throw new AccessError("현재 PIN이 맞지 않아요.", 400);
    await clearAttempt(board.id, ip);
    const token = newToken();
    const { error } = await db().rpc("dm_configure_access", { p_board: board.id, p_session: board.sessionHash,
      p_expected_hash: stored.pin_hash, p_pin_hash: await hashPin(body.newPin), p_names: board.memberNames,
      p_new_session: tokenHash(token), p_expires: sessionExpiry(board.remember), p_remember: board.remember });
    if (error) throw new Error("PIN을 바꾸지 못했어요. 다시 시도해 주세요.");
    return setSessionCookie(NextResponse.json({ message: "새 PIN으로 바꿨어요. 다른 기기에서는 새 PIN으로 열어 주세요." }), token, board.remember);
  } catch (e) { return accessError(e); }
}
