"use client";
import { useEffect, useMemo, useState } from "react";
import { isNewPlace, NEW_PLACE_WINDOW } from "@/lib/new-places";
import type { PlaceView } from "@/lib/place-view";

const NONE: ReadonlySet<string> = new Set();
/** NEW 장소 id: 등록 24시간 안이고 내가 아직 보지 않은 곳(seen). */
export default function useNewPlaceIds(places: PlaceView[], seen: ReadonlySet<string> = NONE) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const time = Date.now(); setNow(time);
      const expirations = places.filter((p) => isNewPlace(p.created_at, time, p.status)).map((p) => Date.parse(p.created_at) + NEW_PLACE_WINDOW);
      if (expirations.length) timer = setTimeout(update, Math.min(...expirations) - time + 1);
    };
    update(); document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [places]);
  return useMemo(() => new Set(places.filter((p) => isNewPlace(p.created_at, now, p.status, seen.has(p.id))).map((p) => p.id)), [places, now, seen]);
}
