import { env } from "./env";
import type { KakaoPlace } from "./types";
import type { PlaceCandidate } from "./extract/types";
import { nameKey } from "./extract/normalize";
import { MAX_SEARCH_PAGE, SEARCH_PAGE_SIZE, validSearchPage } from "./search-page";

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
  if (!res.ok) {
    console.error("Kakao local API failed", res.status, path);
    throw new Error("카카오 장소 검색에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
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

/** Interactive search retains Kakao's pagination metadata; extraction keeps its own search. */
export async function keywordSearchPage(query: string, page = 1, fetcher: Fetcher = fetch) {
  if (!validSearchPage(page)) throw new Error("검색 결과 페이지가 올바르지 않아요.");
  const result = await kakaoGet<{ documents: KakaoDoc[]; meta: { is_end: boolean; total_count: number } }>(
    "/v2/local/search/keyword.json", { query, page: String(page), size: String(SEARCH_PAGE_SIZE) }, fetcher);
  return { places: (result?.documents ?? []).map(toKakaoPlace), page,
    is_end: result?.meta?.is_end !== false || page >= MAX_SEARCH_PAGE,
    total_count: result?.meta?.total_count ?? 0 };
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
  return road ? normalizeRegions(road).replace(/\s/g, "") : null;
}

function matchesName(place: KakaoPlace, cand: PlaceCandidate) {
  return nameKey(place.name).includes(nameKey(cand.name));
}

function normalizeRegions(value: string): string {
  return value
    .replace(/특별자치시|특별자치도|특별시|광역시/g, "")
    .replace(/경기도/g, "경기").replace(/강원도/g, "강원")
    .replace(/충청북도/g, "충북").replace(/충청남도/g, "충남")
    .replace(/전라북도/g, "전북").replace(/전라남도/g, "전남")
    .replace(/경상북도/g, "경북").replace(/경상남도/g, "경남").replace(/제주도/g, "제주");
}

function locationKey(value: string): string {
  return nameKey(normalizeRegions(value));
}

/** 지역명은 주소나 지점 표기로 확인하며, 상호 자체에 든 지역명은 근거로 삼지 않습니다. */
function matchesArea(place: KakaoPlace, cand: PlaceCandidate): boolean {
  if (!cand.areaHint?.trim()) return true;
  const address = locationKey(place.address);
  const branch = locationKey(place.name).replace(locationKey(cand.name), "");
  return cand.areaHint.trim().split(/[\s,/·]+/).every((part) => {
    const area = locationKey(part);
    if (address.includes(area) || branch.includes(area)) return true;
    // 도로명 주소에 동 이름이 없어도 "성수동"과 지점명 "성수"는 같은 근거입니다.
    const neighborhood = area.replace(/동(?:\d+가)?$/, "");
    return neighborhood !== area && neighborhood.length >= 2 && branch.includes(neighborhood);
  });
}

/** 지번/도로명 간 직접 비교가 어려워도 명시된 시·군·구가 다르면 확인을 받습니다. */
function matchesAddressArea(place: KakaoPlace, address: string | null): boolean {
  const actual = place.address.trim().split(/\s+/).map(locationKey);
  for (const part of address?.trim().split(/\s+/) ?? []) {
    const area = locationKey(part);
    const province = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(area);
    if (!province && !/(시|군|구)$/.test(area)) break;
    if (province ? actual[0] !== area : !actual.includes(area)) return false;
  }
  return true;
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

/** 추출한 위치와 모순이 없고, 단일 후보이거나 다른 후보보다 충분히 확실할 때만 자동 저장합니다. */
export function isConfident(cand: PlaceCandidate, places: KakaoPlace[]): boolean {
  if (places.length === 0) return false;
  const first = places[0];
  const address = cand.address ? addressKey(cand.address) : null;
  const selectedAddress = addressKey(first.address);
  const sameAddress = !!address && selectedAddress === address;
  if (!matchesName(first, cand) || !matchesArea(first, cand) || !matchesAddressArea(first, cand.address)) return false;
  if (address && selectedAddress && !sameAddress) return false;
  const branch = nameKey(cand.branch ?? "").replace(/점$/, "");
  // 정확한 주소는 "수원본점" / "본점" 같은 지점 표기 차이를 보완합니다.
  if (branch && !sameAddress && !nameKey(first.name).includes(branch)) return false;
  if (cand.confidence >= 0.6 && sameAddress &&
      !places.slice(1).some((p) => addressKey(p.address) === address)) return true;
  if (places.length === 1) return cand.confidence >= 0.5;
  const [a, b] = places.map((p) => scorePlace(p, cand));
  return cand.confidence >= 0.6 && nameKey(places[0].name) === nameKey(cand.name, cand.branch) && a - b >= 3;
}
