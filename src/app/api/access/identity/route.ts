import { NextResponse } from "next/server";
import { boardFromRequest, unauthorized, AccessError, accessError, safeNext } from "@/lib/auth";
import { db } from "@/lib/db";
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const body = await req.json().catch(() => null);
    if (!board.memberNames.includes(body?.name)) throw new AccessError("우리 두 사람 중 이름을 골라 주세요.");
    const { error } = await db().from("access_sessions").update({ member_name: body.name }).eq("token_hash", board.sessionHash);
    if (error) throw new Error("이름을 기억하지 못했어요. 다시 골라 주세요.");
    return NextResponse.json({ next: safeNext(body?.next) });
  } catch (e) { return accessError(e); }
}
