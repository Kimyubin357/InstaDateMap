import { accountFromRequest, unauthorized, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";

export interface TrashLogItem { id: string; board_id: string | null; board_name: string; name: string; address: string | null; memo: string | null; deleted_at: string; restorable: boolean; current: boolean;
  /** 줄 왼쪽 사진(가게 정보 캐시의 첫 사진, 없으면 null)과 분류 아이콘용 분류 */
  photo?: string | null; category?: string | null }

/** 내 삭제 기록: 모든 방에서 내가 지운 장소. 방이 없어졌거나 나간 방의 기록은 복구할 수 없습니다(017). */
export async function GET(req: Request) {
  try {
    const account = await accountFromRequest(req);
    if (!account) return unauthorized();
    const [logs, rooms] = await Promise.all([
      db().from("place_trash_log").select("id, board_id, board_name, place, deleted_at").eq("user_id", account.userId).order("deleted_at", { ascending: false }),
      db().from("board_members").select("board_id").eq("user_id", account.userId),
    ]);
    if (logs.error || rooms.error) throw new Error("삭제한 장소를 불러오지 못했어요. 다시 시도해 주세요.");
    const mine = new Set((rooms.data ?? []).map((r) => r.board_id as string));
    // 지운 장소의 가게 사진은 장소 id가 아니라 카카오 장소 id로 캐시돼 있어 그대로 씁니다(없으면 분류 아이콘).
    const kakaoIds = [...new Set((logs.data ?? []).map((l) => l.place?.kakao_place_id).filter((id): id is string => typeof id === "string" && !!id))];
    const photos = new Map<string, string>();
    if (kakaoIds.length) {
      const cache = await db().from("place_details").select("kakao_place_id, photos").in("kakao_place_id", kakaoIds);
      for (const row of cache.data ?? []) { const url = (row.photos as { url?: string }[] | null)?.[0]?.url; if (url) photos.set(row.kakao_place_id as string, url); }
    }
    const places: TrashLogItem[] = (logs.data ?? []).map((l) => ({
      id: l.id, board_id: l.board_id, board_name: l.board_name, name: l.place?.name ?? "", address: l.place?.address ?? null, memo: l.place?.memo ?? null,
      deleted_at: l.deleted_at, restorable: !!l.board_id && mine.has(l.board_id), current: !!l.board_id && l.board_id === account.boardId,
      photo: (l.place?.kakao_place_id && photos.get(l.place.kakao_place_id)) || null, category: l.place?.category ?? null,
    }));
    return Response.json({ places }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessError(error); }
}
