/**
 * 네이버 플레이스 공개 모바일 페이지에서 가게 정보를 읽습니다(공식 API 없음).
 * 페이지 형식이 바뀌면 빈 결과로 처리하고, 화면은 카카오 정보만으로 계속 동작합니다.
 */
export interface PlacePhoto { url: string; width: number | null; height: number | null }
export interface PlaceMenu { name: string; price: string | null }
export interface PlaceHoursDay { day: string; open: string | null; close: string | null; breaks: string[]; note: string | null }
export interface PlaceHours { status: string | null; description: string | null; days: PlaceHoursDay[] }
export interface NaverPlace { id: string; lat: number | null; lng: number | null; phone: string | null; photos: PlacePhoto[]; menus: PlaceMenu[]; hours: PlaceHours | null; bookingUrl: string | null; needsMenuPage: boolean }
export interface NaverCandidate { id: string; name: string | null; lat: number | null; lng: number | null }

const MAX_PHOTOS = 5, MAX_MENUS = 8;
const text = (v: unknown, max = 200) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const https = (v: unknown) => { const s = text(v, 1000); return s && /^https:\/\/[a-z0-9.-]+\.(pstatic\.net|naver\.com|naver\.net)\//i.test(s) ? s : null; };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** 검색 결과 이름의 HTML 문자(&amp; 등)를 원래 글자로: "씨랄라워터파크&amp;찜질방" → "씨랄라워터파크&찜질방" */
export const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** `"Prefix:id":{...}` 형태의 객체를 문자열 안의 괄호까지 고려해 꺼냅니다. */
export function apolloObjects(html: string, prefix: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const needle = `"${prefix}:`;
  let from = 0;
  while (out.length < 50) {
    const key = html.indexOf(needle, from);
    if (key < 0) break;
    const open = html.indexOf("{", key + needle.length);
    const colon = html.indexOf('":', key + needle.length);
    if (open < 0 || colon < 0 || open !== colon + 2) { from = key + needle.length; continue; }
    let depth = 0, inString = false, end = -1;
    for (let i = open; i < html.length; i++) {
      const c = html[i];
      if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { end = i; break; }
    }
    if (end < 0) break;
    try { out.push(JSON.parse(html.slice(open, end + 1))); } catch { /* 형식이 다른 조각은 건너뜁니다 */ }
    from = end + 1;
  }
  return out;
}

/** 검색 결과 페이지: 목록 항목(좌표 포함)과 단일 결과 카드의 장소 링크 */
export function parseSearch(html: string): NaverCandidate[] {
  const list = apolloObjects(html, "PlaceListBusinessesItem").flatMap((o) => {
    const id = text(o.id, 20);
    return id && /^\d+$/.test(id) ? [{ id, name: text(decodeEntities(stripTags(String(o.name ?? "")))), lat: num(o.y), lng: num(o.x) }] : [];
  });
  const linked = [...html.matchAll(/place\.naver\.com\/(?:restaurant|place|cafe|hairshop|accommodation|hospital|attraction)\/(\d{1,15})/g)].map((m) => m[1]);
  const seen = new Set(list.map((c) => c.id));
  for (const id of linked) if (!seen.has(id)) { seen.add(id); list.push({ id, name: null, lat: null, lng: null }); }
  return list.slice(0, 10);
}

function apolloState(html: string): Record<string, any> | null {
  const marker = "window.__APOLLO_STATE__ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf(";\n", start);
  try { return JSON.parse(html.slice(start + marker.length, end < 0 ? undefined : end)); } catch { return null; }
}
const won = (price: unknown) => {
  const digits = typeof price === "string" || typeof price === "number" ? String(price).replace(/[^\d]/g, "") : "";
  return digits ? `${Number(digits).toLocaleString("ko-KR")}원` : null;
};

/** 장소 홈 페이지: 좌표·전화·사진(가게 등록 사진 먼저)·영업시간·네이버 예약·메뉴 */
export function parsePlaceHome(html: string, id: string): NaverPlace | null {
  const st = apolloState(html);
  if (!st) return null;
  const root = st.ROOT_QUERY ?? {};
  const detail = Object.entries(root).find(([k]) => k.startsWith("placeDetail("))?.[1] as Record<string, any> | undefined;
  const base = Object.entries(st).find(([k]) => k.startsWith("PlaceDetailBase:"))?.[1] as Record<string, any> | undefined;
  if (!detail && !base) return null;
  const resolve = (ref: any) => ref?.__ref ? st[ref.__ref] : ref;
  const photos = ((detail?.topPhotos?.items ?? []) as unknown[]).map(resolve)
    .filter((p: any) => p && p.mediaFormat === "image" && https(p.originalUrl))
    .sort((a: any, b: any) => Number(b.mediaSource === "business") - Number(a.mediaSource === "business"))
    .slice(0, MAX_PHOTOS).map((p: any) => ({ url: https(p.originalUrl)!, width: num(p.width), height: num(p.height) }));
  if (!photos.length) for (const img of (detail?.images?.images ?? []).slice(0, MAX_PHOTOS)) { const url = https(img?.origin); if (url) photos.push({ url, width: num(img.width), height: num(img.height) }); }
  const menus = Object.entries(st).filter(([k]) => k.startsWith("Menu:")).map(([, v]) => v as Record<string, any>)
    .sort((a, b) => (num(a.index) ?? 0) - (num(b.index) ?? 0)).slice(0, MAX_MENUS)
    .flatMap((m) => { const name = text(m.name, 60); return name ? [{ name, price: won(m.price) }] : []; });
  const nb = (detail?.newBusinessHours ?? [])[0];
  const hours: PlaceHours | null = nb ? {
    status: text(nb.businessStatusDescription?.status, 30), description: text(nb.businessStatusDescription?.description, 80),
    days: ((nb.businessHours ?? []) as any[]).slice(0, 14).flatMap((d) => { const day = text(d?.day, 10); return day ? [{ day,
      open: text(d.businessHours?.start, 10), close: text(d.businessHours?.end, 10),
      breaks: ((d.breakHours ?? []) as any[]).flatMap((b) => b?.start && b?.end ? [`${b.start}~${b.end}`] : []).slice(0, 3),
      note: text(d.description, 80) }] : []; }),
  } : null;
  const phone = text(detail?.phoneInfo?.phone, 30) ?? text(base?.virtualPhone, 30) ?? text(base?.phone, 30);
  return { id, lat: num(base?.coordinate?.y), lng: num(base?.coordinate?.x), phone: phone && /^[\d-]{7,20}$/.test(phone) ? phone : null,
    photos, menus, hours: hours && (hours.status || hours.days.length) ? hours : null,
    bookingUrl: https(detail?.naverBooking?.naverBookingUrl), needsMenuPage: !menus.length };
}

/** 음식점의 메뉴 탭(홈에 메뉴가 없을 때만 읽습니다) */
export function parseMenuPage(html: string): PlaceMenu[] {
  const st = apolloState(html);
  if (!st) return [];
  return Object.entries(st).filter(([k]) => k.startsWith("PlaceMenuItem:")).map(([, v]) => v as Record<string, any>).slice(0, MAX_MENUS)
    .flatMap((m) => { const name = text(m.name, 60); return name ? [{ name, price: text(m.price?.displayText, 30) }] : []; });
}

/** 두 좌표 사이 거리(m) */
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
const compact = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\s()[\]{}·.,'"&\-_/]|점$/g, "");
export function similarName(a: string | null, b: string) {
  if (!a) return false;
  const x = compact(decodeEntities(a)), y = compact(decodeEntities(b));
  return !!x && !!y && (x.includes(y) || y.includes(x));
}
/** 같은 가게로 볼 후보: 150m 안에서 이름이 비슷하거나, 30m 안. 가장 가까운 후보를 고릅니다. */
export function pickCandidate(candidates: NaverCandidate[], place: { name: string; lat: number; lng: number }) {
  const scored = candidates.flatMap((c) => c.lat == null || c.lng == null ? [] : [{ c, d: distance(place, { lat: c.lat, lng: c.lng }) }])
    .filter(({ c, d }) => d <= 30 || (d <= 150 && similarName(c.name, place.name))).sort((a, b) => a.d - b.d);
  return scored[0]?.c ?? null;
}
/**
 * 첫 검색이 비었을 때 다시 물을 검색어들: 지점 이름("본점", "성수점")을 뺀 상호 + 구 → 상호만.
 * 네이버는 "숲속한방랜드 본점 서대문구"처럼 지점·지역을 붙이면 결과를 하나도 주지 않기도 합니다(2026-11-26).
 */
export function fallbackQueries(name: string, address: string | null) {
  const bare = name.replace(/\s+\S*점$/, "").trim();
  const area = address?.match(/\S+[구군]\b/)?.[0] ?? address?.split(/\s+/)[1] ?? "";
  return [...new Set([bare !== name ? `${bare} ${area}`.trim() : "", bare].filter((q) => q && q !== searchQuery(name, address)))].map((q) => q.slice(0, 80));
}
/** 검색어: 상호 + 주소의 구·시(동명이 많은 체인점 구분용) */
export function searchQuery(name: string, address: string | null) {
  const area = address?.match(/\S+[구군]\b/)?.[0] ?? address?.split(/\s+/)[1] ?? "";
  return `${name} ${area}`.trim().slice(0, 80);
}
