"use client";
import { useEffect, useMemo, useState } from "react";
import { isNewPlace, NEW_PLACE_WINDOW } from "@/lib/new-places";
import type { PlaceView } from "@/lib/place-view";

export default function useNewPlaceIds(places: PlaceView[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const time = Date.now(); setNow(time);
      const expirations = places.filter((p) => isNewPlace(p.created_at, time)).map((p) => Date.parse(p.created_at) + NEW_PLACE_WINDOW);
      if (expirations.length) timer = setTimeout(update, Math.min(...expirations) - time + 1);
    };
    update(); document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [places]);
  return useMemo(() => new Set(places.filter((p) => isNewPlace(p.created_at, now)).map((p) => p.id)), [places, now]);
}
