import { boardFromRequest, unauthorized, accessError, AccessError } from "@/lib/auth";
import { keywordSearch } from "@/lib/kakao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 확인 화면의 직접 검색 */
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const q = new URL(req.url).searchParams.get("q")?.trim();
    if (!q) return Response.json({ places: [] }, { headers: { "Cache-Control": "no-store" } });
    if (q.length > 100) throw new AccessError("검색어는 100자 이내로 입력해 주세요.");
    const places = await keywordSearch(q);
    return Response.json({ places: places.slice(0, 8) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
