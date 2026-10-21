import { NextResponse } from "next/server";
import { setupSession, sessionExpiry, setSessionCookie } from "@/lib/access";
import { AccessError, accessError, checkOrigin, safeNext, SETUP_COOKIE } from "@/lib/auth";
import { hashPin, pinFromDate, newToken, tokenHash } from "@/lib/pin";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const session = await setupSession(req);
    const body = await req.json().catch(() => null);
    const names = Array.isArray(body?.names) ? body.names.map((n: unknown) => typeof n === "string" ? n.trim() : "") : [];
    if (names.length !== 2 || names.some((n: string) => !n || n.length > 20) || names[0] === names[1]) throw new AccessError("서로 다른 두 이름을 20자 이내로 입력해 주세요.");
    let pin: string;
    try { pin = pinFromDate(typeof body?.date === "string" ? body.date : ""); }
    catch { throw new AccessError("사귀기 시작한 날짜를 올바르게 선택해 주세요."); }
    if (body?.confirmPin !== pin) throw new AccessError("날짜로 만든 여섯 자리 PIN을 확인해 주세요.");
    const token = newToken();
    const remember = body?.remember === true;
    const { error } = await db().rpc("dm_configure_access", { p_board: session.board_id, p_session: session.token_hash,
      p_expected_hash: null, p_pin_hash: await hashPin(pin), p_names: names, p_new_session: tokenHash(token),
      p_expires: sessionExpiry(remember), p_remember: remember });
    if (error) throw new AccessError("PIN을 설정하지 못했어요. 이미 설정되었다면 입장 화면에서 열어 주세요.", 409);
    const res = NextResponse.json({ next: `/choose?next=${encodeURIComponent(safeNext(body?.next))}` });
    res.cookies.delete(SETUP_COOKIE);
    return setSessionCookie(res, token, remember);
  } catch (e) { return accessError(e); }
}
