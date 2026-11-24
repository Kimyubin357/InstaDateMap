import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { deliverPlacePushes, pushConfiguration } from "@/lib/push-server";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Independent scheduler entry point: no browser cookie or user activity required. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    if (!pushConfiguration()) throw new Error("Push configuration unavailable");
    // Account folders: retry every folder that still has unsent notifications.
    const { data, error } = await db().rpc("dm_push_board_ids");
    if (error || !Array.isArray(data)) throw new Error("Push board lookup failed");
    for (const boardId of data as string[]) await deliverPlacePushes(boardId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("예약 알림 재시도 실패: 서버 설정과 DB 연결을 확인해 주세요.");
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
