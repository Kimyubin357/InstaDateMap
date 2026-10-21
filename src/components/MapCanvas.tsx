"use client";
import { useEffect, useRef, useState } from "react";
import { loadScript } from "@/lib/scripts";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
export interface MapPosition { lat: number; lng: number; level: number }
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }
export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, location }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null); const markers = useRef<any[]>([]); const me = useRef<any>(null);
  const position = useRef(initialPosition); const onMove = useRef(onPosition); onMove.current = onPosition;
  const pick = useRef(onPick); pick.current = onPick;
  const fitted = useRef(!!initialPosition); const [ready, setReady] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!apiKey) { setError("지도를 준비하지 못했어요. 잠시 리스트로 확인해 주세요."); return; }
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false`, "kakao-sdk")
      .then(() => window.kakao.maps.load(() => {
        if (cancelled || !el.current || map.current) return;
        const k = window.kakao.maps; const p = position.current;
        map.current = new k.Map(el.current, { center: new k.LatLng(p?.lat ?? 37.28, p?.lng ?? 127.01), level: p?.level ?? 7 });
        k.event.addListener(map.current, "idle", () => {
          const center = map.current.getCenter(); onMove.current({ lat: center.getLat(), lng: center.getLng(), level: map.current.getLevel() });
        });
        setReady(true);
      })).catch(() => setError("지도를 불러오지 못했어요. 연결을 확인하거나 리스트로 봐 주세요."));
    return () => { cancelled = true; };
  }, [apiKey]);
  useEffect(() => {
    if (!ready) return;
    const k = window.kakao.maps;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = places.map((p) => {
      const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}${p.id === selectedId ? " active" : ""}`;
      button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
      const dot = document.createElement("i"); dot.className = "mark";
      const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
      button.onclick = () => pick.current(p.id);
      const marker = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: button, xAnchor: 0, yAnchor: 0, zIndex: p.id === selectedId ? 5 : 1 });
      marker.setMap(map.current); return marker;
    });
    if (!fitted.current && places.length && active) {
      if (places.length === 1) { map.current.setCenter(new k.LatLng(places[0].lat, places[0].lng)); map.current.setLevel(4); }
      else { const bounds = new k.LatLngBounds(); places.forEach((p) => bounds.extend(new k.LatLng(p.lat, p.lng))); map.current.setBounds(bounds, 80, 130, 200, 130); }
      fitted.current = true;
    }
  }, [places, selectedId, ready, active]);
  useEffect(() => {
    if (ready && active) { const center = map.current.getCenter(); map.current.relayout(); map.current.setCenter(center); }
  }, [ready, active]);
  useEffect(() => {
    if (!ready || !el.current) return;
    const observer = new ResizeObserver(() => {
      const center = map.current.getCenter();
      map.current.relayout();
      map.current.setCenter(center);
    });
    observer.observe(el.current);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    if (!ready || !location) return;
    const k = window.kakao.maps; const p = new k.LatLng(location.lat, location.lng);
    if (!me.current) { const content = document.createElement("div"); content.className = "me-dot"; content.setAttribute("aria-label", "내 위치"); me.current = new k.CustomOverlay({ position: p, content, zIndex: 2 }); me.current.setMap(map.current); }
    else me.current.setPosition(p);
    map.current.panTo(p);
  }, [ready, location]);
  return <><div ref={el} className="map-canvas" aria-label="저장한 장소 지도" />{error && <div className="map-notice" role="status">{error}</div>}</>;
}
