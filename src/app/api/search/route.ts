import { boardFromRequest, unauthorized } from "@/lib/auth";
import { keywordSearch } from "@/lib/kakao";

export const runtime = "nodejs";

/** 확인 화면의 직접 검색 */
export async function GET(req: Request) {
  const board = await boardFromRequest(req);
  if (!board) return unauthorized();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ places: [] });
  const places = await keywordSearch(q).catch(() => []);
  return Response.json({ places: places.slice(0, 8) });
}
