import { AccessError, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/folders";
import { noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 새 장소(NEW)를 본 기록(020_place_seen.sql). 장소 카드·상세를 열거나 "모두 본 걸로 하기"를 누르면 적습니다.
 * 020이 아직 적용되지 않은 DB에서는 빈 목록·0으로 답하고(화면은 이 기기의 기록으로 동작), 원인은 서버 로그에만 남깁니다.
 */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const { data, error } = await db().rpc("dm_seen_places", { p_user: account.userId });
    if (error) { console.error("dm_seen_places failed", error.code, error.message); return Response.json({ ids: [] }, noStore); }
    return Response.json({ ids: Array.isArray(data) ? data.filter(isUuid) : [] }, noStore);
  } catch (e) { return accessError(e); }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount(req);
    const body = await req.json().catch(() => null) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids)] : [];
    if (!ids.length || ids.length > 500 || !ids.every(isUuid)) throw new AccessError("확인한 장소를 1~500곳 보내 주세요.");
    const { data, error } = await db().rpc("dm_mark_seen", { p_user: account.userId, p_places: ids });
    if (error) { console.error("dm_mark_seen failed", error.code, error.message); return Response.json({ ok: false, count: 0 }, noStore); }
    return Response.json({ ok: true, count: typeof data === "number" ? data : 0 }, noStore);
  } catch (e) { return accessError(e); }
}
