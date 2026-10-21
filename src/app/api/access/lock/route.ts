import { NextResponse } from "next/server";
import { boardFromRequest, SESSION_COOKIE, accessError, checkOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const board = await boardFromRequest(req);
    if (board) {
      const { error } = await db().from("access_sessions").delete().eq("token_hash", board.sessionHash);
      if (error) throw new Error("이 기기를 잠그지 못했어요. 다시 시도해 주세요.");
    }
    const res = NextResponse.json({ next: "/enter" });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) { return accessError(e); }
}
