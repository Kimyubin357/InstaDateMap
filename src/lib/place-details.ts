import { db } from "./db";
import { env } from "./env";
import { fallbackQueries, parseMenuPage, parsePlaceHome, parseSearch, pickCandidate, searchQuery, distance, type NaverPlace, type PlaceHours, type PlaceMenu, type PlacePhoto } from "./naver-place";

export interface PlaceDetails {
  status: "ok" | "not_found" | "error";
  naver_place_id: string | null; naver_url: string | null;
  phone: string | null; photos: PlacePhoto[]; menus: PlaceMenu[]; hours: PlaceHours | null;
  booking_url: string | null; catchtable_url: string | null; fetched_at: string;
}
export interface DetailTarget { kakao_place_id: string; name: string; address: string | null; lat: number; lng: number }
type Fetcher = typeof fetch;

/** 다시 읽기까지: 찾음 7일, 못 찾음 3일, 오류 30분 */
const TTL = { ok: 7 * 86400e3, not_found: 86400e3, error: 30 * 60e3 } as const;
/** 네이버에서 가게를 못 찾고 카카오 전화번호만 저장한 예전 "ok" 줄은 사진이 없으므로 몇 시간 뒤 다시 찾습니다(2026-11-26). */
const PHONE_ONLY_TTL = 6 * 3600e3;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const inFlight = new Map<string, Promise<PlaceDetails>>();

export const naverUrl = (id: string) => `https://m.place.naver.com/place/${id}/home`;
export function toDetails(row: Record<string, any>): PlaceDetails {
  return { status: row.status, naver_place_id: row.naver_place_id ?? null, naver_url: row.naver_place_id ? naverUrl(row.naver_place_id) : null,
    phone: row.phone ?? null, photos: row.photos ?? [], menus: row.menus ?? [], hours: row.hours ?? null,
    booking_url: row.booking_url ?? null, catchtable_url: row.catchtable_url ?? null, fetched_at: row.fetched_at };
}
export const isFresh = (row: { status: keyof typeof TTL; fetched_at: string; naver_place_id?: string | null }, now = Date.now()) =>
  now - new Date(row.fetched_at).getTime() < (row.status === "ok" && "naver_place_id" in row && !row.naver_place_id ? PHONE_ONLY_TTL : TTL[row.status]);

async function page(url: string, fetcher: Fetcher) {
  const res = await fetcher(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Accept: "text/html" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  return res.text();
}

/** 카카오에서 같은 장소를 다시 찾아 전화번호만 가져옵니다(네이버에서 못 찾았을 때의 보조). */
export async function kakaoPhone(target: DetailTarget, fetcher: Fetcher): Promise<string | null> {
  const qs = new URLSearchParams({ query: target.name, x: String(target.lng), y: String(target.lat), radius: "300", size: "15" });
  const res = await fetcher(`https://dapi.kakao.com/v2/local/search/keyword.json?${qs}`, { headers: { Authorization: `KakaoAK ${env.kakaoRestKey()}` }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as { documents?: { id: string; phone?: string }[] } | null;
  const phone = body?.documents?.find((d) => d.id === target.kakao_place_id)?.phone?.trim();
  return phone && /^[\d-]{7,20}$/.test(phone) ? phone : null;
}

/** 네이버 검색 → 같은 가게 고르기 → 장소 홈(필요하면 메뉴 탭)까지 읽습니다. */
export async function findNaverPlace(target: DetailTarget, fetcher: Fetcher): Promise<NaverPlace | null> {
  const search = (query: string) => page(`https://m.search.naver.com/search.naver?where=m_local&query=${encodeURIComponent(query)}`, fetcher);
  let candidates = parseSearch(await search(searchQuery(target.name, target.address)));
  // 지점·지역을 붙인 검색이 비면 더 짧은 검색어로 한 번씩 더 묻습니다(좌표·이름 확인은 똑같이 합니다).
  for (const query of fallbackQueries(target.name, target.address)) { if (candidates.length) break; candidates = parseSearch(await search(query)); }
  const near = (p: NaverPlace | null) => p && p.lat != null && p.lng != null && distance(target, { lat: p.lat, lng: p.lng }) <= 150 ? p : null;
  let picked = pickCandidate(candidates, target);
  let place: NaverPlace | null = null;
  if (picked) place = parsePlaceHome(await page(naverUrl(picked.id), fetcher), picked.id);
  else {
    // 단일 결과 카드는 좌표가 없어 장소 홈에서 좌표로 확인합니다(최대 2곳).
    for (const c of candidates.filter((c) => c.lat == null).slice(0, 2)) {
      place = near(parsePlaceHome(await page(naverUrl(c.id), fetcher), c.id));
      if (place) { picked = c; break; }
    }
  }
  if (!picked || !place) return null;
  if (place.needsMenuPage) {
    try { place.menus = parseMenuPage(await page(`https://m.place.naver.com/restaurant/${picked.id}/menu/list`, fetcher)); }
    catch { /* 메뉴는 없어도 나머지 정보를 보여줍니다 */ }
  }
  return place;
}

async function collect(target: DetailTarget, fetcher: Fetcher): Promise<Omit<PlaceDetails, "naver_url" | "fetched_at">> {
  const [naver, phone] = await Promise.allSettled([findNaverPlace(target, fetcher), kakaoPhone(target, fetcher)]);
  const kakao = phone.status === "fulfilled" ? phone.value : null;
  if (naver.status === "rejected") {
    console.warn("place details: naver lookup failed", naver.reason instanceof Error ? naver.reason.message : naver.reason);
    // 네이버가 잠깐 막히거나 늦으면 "실패"로 짧게(30분) 저장하고 다시 찾습니다. 카카오 전화번호는 그대로 보여 줍니다.
    return { status: "error", naver_place_id: null, phone: kakao, photos: [], menus: [], hours: null, booking_url: null, catchtable_url: null };
  }
  const p = naver.value;
  if (!p) return { status: "not_found", naver_place_id: null, phone: kakao, photos: [], menus: [], hours: null, booking_url: null, catchtable_url: null };
  return { status: "ok", naver_place_id: p.id, phone: kakao ?? p.phone, photos: p.photos, menus: p.menus, hours: p.hours, booking_url: p.bookingUrl, catchtable_url: null };
}

/** 캐시가 신선하면 그대로, 아니면 새로 읽어 저장합니다. 같은 장소의 동시 요청은 한 번만 읽습니다. */
export async function placeDetails(target: DetailTarget, fetcher: Fetcher = fetch, now = Date.now()): Promise<PlaceDetails> {
  const { data: cached, error } = await db().from("place_details").select("*").eq("kakao_place_id", target.kakao_place_id).maybeSingle();
  if (error) console.error("place_details read failed", error.code, error.message);
  if (cached && isFresh(cached, now)) return toDetails(cached);
  const running = inFlight.get(target.kakao_place_id);
  if (running) return running;
  const task = (async () => {
    const found = await collect(target, fetcher);
    // 일시 오류는 예전에 찾은 정보를 덮어쓰지 않습니다.
    if (found.status === "error" && cached?.status === "ok") return toDetails(cached);
    const row = { kakao_place_id: target.kakao_place_id, ...found, fetched_at: new Date(now).toISOString() };
    const { error: writeError } = await db().from("place_details").upsert(row, { onConflict: "kakao_place_id" });
    if (writeError) console.error("place_details write failed", writeError.code, writeError.message);
    return toDetails(row);
  })().finally(() => inFlight.delete(target.kakao_place_id));
  inFlight.set(target.kakao_place_id, task);
  return task;
}
