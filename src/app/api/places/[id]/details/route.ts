import { boardFromRequest, unauthorized, requireIdentity, accessError, AccessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { placeDetails } from "@/lib/place-details";
export const runtime = "nodejs";
export const maxDuration = 30;

/** 장소 상세의 가게 정보(전화·사진·메뉴·영업시간·예약). 이 폴더의 장소만 조회합니다. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const { id } = await params;
    const { data: place, error } = await db().from("places").select("kakao_place_id, name, address, lat, lng").is("deleted_at", null).eq("id", id).eq("board_id", board.id).maybeSingle();
    if (error) { console.error("place details: place read failed", error.code, error.message); throw new Error("가게 정보를 불러오지 못했어요."); }
    if (!place) throw new AccessError("이미 삭제된 장소예요.", 404);
    if (!place.kakao_place_id) return Response.json({ status: "not_found", naver_place_id: null, naver_url: null, phone: null, photos: [], menus: [], hours: null, booking_url: null, catchtable_url: null, fetched_at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await placeDetails(place), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) { return accessError(e); }
}
