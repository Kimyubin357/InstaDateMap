import { accessError } from "@/lib/auth";
import { requireAccount } from "@/lib/folders-server";
import { allPlacesEtag, allRoomPlaces, roomSummaries } from "@/lib/rooms-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 전체 보기: 내가 들어간 모든 방의 장소(방 id와 함께). 방 목록·방마다의 변경 번호가 그대로면 304.
 * 고치기·지우기는 그 장소의 방으로 보냅니다(/api/places/[id]?room=, 멤버 확인은 계정 id).
 */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const { rooms, members } = await roomSummaries(account.userId);
    const etag = await allPlacesEtag(account.userId, rooms);
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    const places = await allRoomPlaces(rooms, members);
    return Response.json({ current: account.boardId, rooms, places }, { headers: { "Cache-Control": "no-store", ETag: etag } });
  } catch (e) { return accessError(e); }
}
