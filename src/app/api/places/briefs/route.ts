import { accessError, AccessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { listFolders, requireAccount } from "@/lib/folders-server";
import { isFresh, placeDetails, toDetails, type DetailTarget, type PlaceDetails } from "@/lib/place-details";
import type { BriefsResponse, PlaceBrief } from "@/lib/place-brief";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IDS = 40, FETCH_PER_CALL = 4;
const brief = (d: PlaceDetails): PlaceBrief | null =>
  d.status !== "ok" || (!d.photos.length && !d.hours) ? null : { photo: d.photos[0]?.url ?? null, hours: d.hours };

/**
 * 장소 리스트의 가게 사진·영업시간(카카오 장소 id 기준). 내가 들어간 방에 있는 장소만 답합니다.
 * 캐시(place_details)에 없거나 오래된 곳은 이번 요청에서 4곳까지만 새로 읽고, 나머지는 pending으로 돌려줘 화면이 다시 묻습니다.
 */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const ids = [...new Set((new URL(req.url).searchParams.get("k") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9A-Za-z_-]{1,40}$/.test(s)))].slice(0, MAX_IDS);
    if (!ids.length) throw new AccessError("장소를 골라 주세요.");
    const boards = (await listFolders(account.userId)).map((f) => f.id);
    if (!boards.length) return Response.json({ briefs: {}, pending: [] } satisfies BriefsResponse, { headers: { "Cache-Control": "no-store" } });
    const [placeResult, cacheResult] = await Promise.all([
      db().from("places").select("kakao_place_id, name, address, lat, lng").is("deleted_at", null).in("board_id", boards).in("kakao_place_id", ids),
      db().from("place_details").select("*").in("kakao_place_id", ids),
    ]);
    if (placeResult.error || cacheResult.error) {
      const e = placeResult.error ?? cacheResult.error!;
      console.error("place briefs read failed", e.code, e.message);
      throw new Error("가게 정보를 불러오지 못했어요.");
    }
    const targets = new Map<string, DetailTarget>();
    for (const p of placeResult.data ?? []) if (p.kakao_place_id && !targets.has(p.kakao_place_id)) targets.set(p.kakao_place_id, p as DetailTarget);
    const cached = new Map((cacheResult.data ?? []).map((r) => [r.kakao_place_id as string, r]));
    const briefs: BriefsResponse["briefs"] = {};
    const stale: DetailTarget[] = [];
    for (const [id, target] of targets) {
      const row = cached.get(id);
      if (row && isFresh(row)) briefs[id] = brief(toDetails(row));
      else { if (row) briefs[id] = brief(toDetails(row)); stale.push(target); }
    }
    const now = stale.slice(0, FETCH_PER_CALL);
    const results = await Promise.allSettled(now.map((t) => placeDetails(t)));
    results.forEach((r, i) => { if (r.status === "fulfilled") briefs[now[i].kakao_place_id] = brief(r.value); });
    return Response.json({ briefs, pending: stale.slice(FETCH_PER_CALL).map((t) => t.kakao_place_id) } satisfies BriefsResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}
