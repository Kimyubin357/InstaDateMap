"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { requestJson } from "@/lib/client-request";
import type { BriefsResponse, PlaceBrief } from "@/lib/place-brief";

/**
 * 장소 리스트의 가게 사진·영업시간. 앱 전체가 한 캐시를 씁니다(카카오 장소 id → 정보, 없으면 null).
 * 서버는 한 번에 4곳까지만 네이버에서 새로 읽으므로, 남은 곳(pending)은 차례로 다시 묻습니다(최대 20번).
 */
const cache = new Map<string, PlaceBrief | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0, running = false, rounds = 0;
const queue: string[] = [];
const emit = () => { version++; listeners.forEach((l) => l()); };

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length && rounds < 20) {
      rounds++;
      const batch = queue.splice(0, 40);
      try {
        const res = await requestJson<BriefsResponse>(`/api/places/briefs?k=${batch.map(encodeURIComponent).join(",")}`, { cache: "no-store", notifyBoardChange: false, timeoutMs: 30000 });
        for (const [id, b] of Object.entries(res.briefs)) cache.set(id, b);
        // 서버가 이번에 못 읽은 곳은 뒤에 다시 넣고, 서버가 모르는 곳(내 방에 없는 장소)은 빈 값으로 둡니다.
        for (const id of batch) if (!(id in res.briefs) && !res.pending.includes(id)) cache.set(id, null);
        queue.push(...res.pending.filter((id) => !queue.includes(id)));
        emit();
      } catch { break; }
    }
  } finally { running = false; }
}

export function usePlaceBriefs(kakaoIds: readonly (string | null | undefined)[]) {
  const key = kakaoIds.filter(Boolean).join(",");
  useEffect(() => {
    const fresh = key ? key.split(",").filter((id) => !asked.has(id)) : [];
    if (!fresh.length) return;
    fresh.forEach((id) => asked.add(id));
    queue.push(...fresh);
    void pump();
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
