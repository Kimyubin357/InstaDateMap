import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/access";
import { safeNext, accessError } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const next = safeNext(url.searchParams.get("next"));
    const { data: board, error } = await db().from("boards").select("id, pin_hash, auth_version").eq("token", url.searchParams.get("t") || "").maybeSingle();
    if (error) throw new Error("설정 정보를 읽지 못했어요. 데이터베이스 업데이트를 확인해 주세요.");
    if (!board || board.pin_hash || (process.env.APP_BOARD_ID && board.id !== process.env.APP_BOARD_ID)) return NextResponse.redirect(new URL(`/enter?next=${encodeURIComponent(next)}`, req.url));
    const token = await createSession(board.id, board.auth_version, false, "setup");
    const response = NextResponse.redirect(new URL(`/setup?next=${encodeURIComponent(next)}`, req.url));
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    return setSessionCookie(response, token, false, true);
  } catch (e) { return accessError(e); }
}
