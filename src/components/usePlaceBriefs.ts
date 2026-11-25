"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { requestJson } from "@/lib/client-request";
import type { BriefsResponse, PlaceBrief } from "@/lib/place-brief";

/**
 * 장소 리스트의 가게 사진·영업시간. 앱 전체가 한 캐시를 씁니다(카카오 장소 id → 정보, 없으면 null).
 * 서버는 한 번에 4곳까지만 네이버에서 새로 읽으므로, 남은 곳(pending)은 차례로 다시 묻습니다(한 번 돌 때 최대 20번).
 * 요청이 실패하면 잠깐 쉬었다 같은 곳을 다시 묻고, 그래도 안 되면 '물어봄'에서 풀어 다음에 리스트를 볼 때 다시 묻습니다.
 * 사진이 없다는 답(null)도 10분이 지나면 다시 묻습니다(그사이 상세에서 사진을 읽어 캐시가 채워졌을 수 있음).
 */
const cache = new Map<string, PlaceBrief | null>();
const emptyAt = new Map<string, number>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0, running = false;
const queue: string[] = [];
const MAX_ROUNDS = 20, MAX_FAILURES = 3, RETRY_EMPTY_MS = 10 * 60e3;
const emit = () => { version++; listeners.forEach((l) => l()); };
function remember(id: string, brief: PlaceBrief | null) {
  cache.set(id, brief);
  if (brief) emptyAt.delete(id); else emptyAt.set(id, Date.now());
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pump() {
  if (running) return;
  running = true;
  let rounds = 0, failures = 0;
  try {
    while (queue.length && rounds < MAX_ROUNDS) {
      rounds++;
      const batch = queue.splice(0, 40);
      try {
        const res = await requestJson<BriefsResponse>(`/api/places/briefs?k=${batch.map(encodeURIComponent).join(",")}`, { cache: "no-store", notifyBoardChange: false, timeoutMs: 30000 });
        failures = 0;
        for (const [id, b] of Object.entries(res.briefs)) remember(id, b);
        // 서버가 이번에 못 읽은 곳은 뒤에 다시 넣고, 서버가 모르는 곳(내 방에 없는 장소)은 빈 값으로 둡니다.
        for (const id of batch) if (!(id in res.briefs) && !res.pending.includes(id)) remember(id, null);
        queue.push(...res.pending.filter((id) => !queue.includes(id)));
        emit();
      } catch {
        // 연결이 끊기거나 서버가 늦으면 같은 묶음을 앞에 되돌려 놓고 잠깐 쉬었다 다시 묻습니다.
        queue.unshift(...batch.filter((id) => !queue.includes(id)));
        if (++failures >= MAX_FAILURES) break;
        await wait(1500 * failures);
      }
    }
  } finally {
    running = false;
    // 이번에 끝내지 못한 곳은 '물어봄'에서 풀어, 다음에 리스트를 볼 때(화면 복귀·전환) 다시 묻습니다.
    for (const id of queue.splice(0)) asked.delete(id);
  }
}
/** 아직 묻지 않았거나, 사진 없음으로 기록한 지 오래된 곳을 화면 순서대로 맨 앞에 넣어 묻습니다. */
function request(ids: string[]) {
  const now = Date.now();
  const fresh = ids.filter((id) => !asked.has(id) || (cache.get(id) === null && now - (emptyAt.get(id) ?? now) > RETRY_EMPTY_MS));
  if (!fresh.length) return;
  fresh.forEach((id) => { asked.add(id); emptyAt.delete(id); });
  // 지금 보는 리스트가 먼저 채워지도록 앞에 넣습니다(다른 방에서 남은 곳은 뒤로).
  const rest = queue.splice(0).filter((id) => !fresh.includes(id));
  queue.push(...fresh, ...rest);
  void pump();
}

export function usePlaceBriefs(kakaoIds: readonly (string | null | undefined)[]) {
  const key = kakaoIds.filter(Boolean).join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!ids.length) return;
    request(ids);
    // 앱으로 돌아오면(다른 앱에 다녀옴) 못 받은 곳을 다시 묻습니다.
    const back = () => { if (document.visibilityState === "visible") request(ids); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [key]);
  useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version, () => 0);
  return (kakaoId: string | null | undefined) => (kakaoId ? cache.get(kakaoId) ?? null : null);
}

/** 위치 권한을 이미 허락한 경우에만 조용히 현재 위치를 받습니다(새로 묻지 않음). 리스트의 거리 표시에 씁니다. */
export function useQuietLocation() {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!navigator.geolocation || !navigator.permissions?.query) return;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (!alive || status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition((p) => { if (alive) setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude }); }, () => {}, { maximumAge: 5 * 60e3, timeout: 8000 });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return origin;
}
