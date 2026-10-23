import { boardFromRequest, unauthorized, accessError, AccessError } from "@/lib/auth";
import { keywordSearchPage } from "@/lib/kakao";
import { validSearchPage } from "@/lib/search-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 확인 화면의 직접 검색 */
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const params = new URL(req.url).searchParams;
    const q = params.get("q")?.trim();
    const page = Number(params.get("page") ?? 1);
    if (!validSearchPage(page)) throw new AccessError("검색 결과 페이지가 올바르지 않아요.");
    if (!q) return Response.json({ places: [] }, { headers: { "Cache-Control": "no-store" } });
    if (q.length > 100) throw new AccessError("검색어는 100자 이내로 입력해 주세요.");
    const result = await keywordSearchPage(q, page);
    return Response.json({ ...result, places: result.places.map((place) => ({ ...place, search_page: page })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
