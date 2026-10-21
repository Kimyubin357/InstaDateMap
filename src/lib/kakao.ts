import { env } from "./env";
import type { KakaoPlace } from "./types";
import type { PlaceCandidate } from "./extract/types";
import { nameKey } from "./extract/normalize";

interface KakaoDoc {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_name: string;
  category_group_name: string;
  x: string;
  y: string;
  place_url: string;
}

type Fetcher = typeof fetch;

async function kakaoGet<T>(path: string, params: Record<string, string>, fetcher: Fetcher): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetcher(`https://dapi.kakao.com${path}?${qs}`, {
    headers: { Authorization: `KakaoAK ${env.kakaoRestKey()}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`카카오 장소 검색 실패 (${res.status}). REST API 키와 카카오맵 사용 설정을 확인해 주세요.`);
  return (await res.json()) as T;
}

export function toKakaoPlace(d: KakaoDoc): KakaoPlace {
  const group = d.category_group_name || d.category_name.split(">").pop()?.trim() || "";
  return {
    kakao_place_id: d.id,
    name: d.place_name,
    address: d.road_address_name || d.address_name,
    lat: Number(d.y),
    lng: Number(d.x),
    category: group,
    kakao_url: d.place_url,
  };
}

export async function keywordSearch(query: string, fetcher: Fetcher = fetch, near?: { lat: number; lng: number }) {
  const params: Record<string, string> = { query, size: "10" };
  if (near) {
    params.x = String(near.lng);
    params.y = String(near.lat);
    params.sort = "distance";
  }
  const r = await kakaoGet<{ documents: KakaoDoc[] }>("/v2/local/search/keyword.json", params, fetcher);
  return (r?.documents ?? []).map(toKakaoPlace);
}

async function geocode(address: string, fetcher: Fetcher) {
  const r = await kakaoGet<{ documents: { x: string; y: string }[] }>(
    "/v2/local/search/address.json",
    { query: roadAddress(address) || address },
    fetcher,
  );
  const d = r?.documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}

/** 상호·층수는 제외하고 도로명과 건물 번호까지 비교합니다. */
function roadAddress(address: string): string | null {
  return address.match(/^(.+?(?:대로|로|길)\s+\d+(?:-\d+)?)(?=\s|$|,)/)?.[1] ?? null;
}

function addressKey(address: string): string | null {
  const road = roadAddress(address);
  return road?.replace(/경기도/g, "경기").replace(/서울특별시/g, "서울").replace(/인천광역시/g, "인천").replace(/\s/g, "") ?? null;
}

function matchesName(place: KakaoPlace, cand: PlaceCandidate) {
  return nameKey(place.name).includes(nameKey(cand.name));
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 검색 결과가 추출한 장소와 얼마나 맞는지 점수 매기기 (높을수록 좋음) */
export function scorePlace(
  p: KakaoPlace,
  cand: Pick<PlaceCandidate, "name" | "branch" | "areaHint">,
  anchor?: { lat: number; lng: number } | null,
): number {
  const pk = nameKey(p.name);
  const nk = nameKey(cand.name);
  const d = anchor ? distanceM(anchor, p) : Infinity;
  let s = 0;
  if (pk === nameKey(cand.name, cand.branch)) s += 5;
  if (pk.includes(nk)) s += 3;
  else if (nk.includes(pk)) s += 1;
  // 이름이 전혀 안 맞으면 주소 바로 앞(150m 이내)이 아닌 이상 후보가 아닙니다.
  if (s === 0 && d >= 150) return 0;
  if (cand.branch) {
    const bk = nameKey(cand.branch).replace(/점$/, "");
    if (bk && pk.includes(bk)) s += 2;
  }
  if (cand.areaHint && (p.address.includes(cand.areaHint) || p.name.includes(cand.areaHint))) s += 1;
  if (d < 150) s += 4;
  else if (d < 1000) s += 2;
  return s;
}

/** 추출한 장소 하나에 대한 카카오 후보 최대 3개 */
export async function resolveCandidate(cand: PlaceCandidate, fetcher: Fetcher = fetch): Promise<KakaoPlace[]> {
  const anchor = cand.address ? await geocode(cand.address, fetcher) : null;
  const queries = [
    [cand.areaHint, cand.name, cand.branch].filter(Boolean).join(" "),
    [cand.name, cand.branch].filter(Boolean).join(" "),
    cand.name,
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  const seen = new Map<string, KakaoPlace>();
  for (const q of queries) {
    for (const p of await keywordSearch(q, fetcher, anchor ?? undefined)) {
      if (!seen.has(p.kakao_place_id)) seen.set(p.kakao_place_id, p);
    }
    if (seen.size >= 3) break;
  }
  return [...seen.values()]
    .map((p) => ({ p, s: scorePlace(p, cand, anchor) }))
    .filter(({ s }) => s >= 3) // 이름이 전혀 안 맞는 결과는 버림
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ p }) => p);
}

/** 사람이 확인하지 않아도 되는 경우: 후보가 하나뿐이거나, 1등이 이름까지 정확히 같고 2등과 차이가 클 때 */
export function isConfident(cand: PlaceCandidate, places: KakaoPlace[]): boolean {
  if (places.length === 0) return false;
  const address = cand.address ? addressKey(cand.address) : null;
  if (cand.confidence >= 0.6 && address && matchesName(places[0], cand) && addressKey(places[0].address) === address &&
      !places.slice(1).some((p) => addressKey(p.address) === address)) return true;
  if (places.length === 1) return cand.confidence >= 0.5;
  const [a, b] = places.map((p) => scorePlace(p, cand));
  return cand.confidence >= 0.6 && nameKey(places[0].name) === nameKey(cand.name, cand.branch) && a - b >= 3;
}
