import { NextResponse } from "next/server";
import { defaultBoard, reserveAttempt, clearAttempt, createSession, setSessionCookie } from "@/lib/access";
import { AccessError, accessError, checkOrigin, safeNext } from "@/lib/auth";
import { verifyPin } from "@/lib/pin";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const body = await req.json().catch(() => null);
    const board = await defaultBoard();
    if (!board.pin_hash) throw new AccessError("아직 PIN을 정하지 않았어요. 처음 받은 지도 주소로 설정해 주세요.", 409);
    const ip = await reserveAttempt(board.id, req);
    if (!await verifyPin(body?.pin, board.pin_hash)) throw new AccessError("PIN이 맞지 않아요. 둘만의 여섯 자리를 다시 확인해 주세요.", 401);
    await clearAttempt(board.id, ip);
    const remember = body?.remember === true;
    const token = await createSession(board.id, board.auth_version, remember);
    return setSessionCookie(NextResponse.json({ next: `/choose?next=${encodeURIComponent(safeNext(body?.next))}` }), token, remember);
  } catch (e) { return accessError(e); }
}
