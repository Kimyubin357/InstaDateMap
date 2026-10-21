"use client";
import { useEffect, useRef, useState } from "react";
import { loadScript } from "@/lib/scripts";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
export interface MapPosition { lat: number; lng: number; level: number }
export type MapViewRequest = { sequence: number; kind: "saved" } | { sequence: number; kind: "place"; lat: number; lng: number };
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }
export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, location, viewRequest }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
  viewRequest: MapViewRequest | null;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null);
  const markers = useRef<{ id: string; button: HTMLButtonElement; overlay: any }[]>([]); const me = useRef<any>(null);
  const position = useRef(initialPosition); const onMove = useRef(onPosition); onMove.current = onPosition;
  const pick = useRef(onPick); pick.current = onPick;
  const fitted = useRef(!!initialPosition); const [ready, setReady] = useState(false); const [error, setError] = useState("");
  const appliedRequest = useRef<number>();
  const layoutSize = useRef({ width: 0, height: 0 });
  function rememberPosition() {
    if (el.current && (el.current.clientWidth !== layoutSize.current.width || el.current.clientHeight !== layoutSize.current.height)) return;
    const center = map.current.getCenter();
    position.current = { lat: center.getLat(), lng: center.getLng(), level: map.current.getLevel() };
    onMove.current(position.current);
  }
  function relayout() {
    // Kakao's getCenter() already reflects the new element width before relayout.
    // Keep the last idle center so resizing doesn't pan the map by half the width delta.
    const p = position.current;
    const center = p ? new window.kakao.maps.LatLng(p.lat, p.lng) : map.current.getCenter();
    layoutSize.current = { width: el.current?.clientWidth || 0, height: el.current?.clientHeight || 0 };
    map.current.relayout(); map.current.setCenter(center); rememberPosition();
  }
  function showSaved() {
    if (!places.length) return;
    const k = window.kakao.maps;
    if (places.length === 1) { map.current.setLevel(4); map.current.setCenter(new k.LatLng(places[0].lat, places[0].lng)); }
    else {
      const bounds = new k.LatLngBounds(); places.forEach((p) => bounds.extend(new k.LatLng(p.lat, p.lng)));
      map.current.setBounds(bounds, 120, 90, 125, 90);
    }
    rememberPosition();
  }
  useEffect(() => {
    let cancelled = false;
    if (!apiKey) { setError("지도를 준비하지 못했어요. 잠시 리스트로 확인해 주세요."); return; }
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false`, "kakao-sdk")
      .then(() => window.kakao.maps.load(() => {
        if (cancelled || !el.current || map.current) return;
        const k = window.kakao.maps; const p = position.current;
        layoutSize.current = { width: el.current.clientWidth, height: el.current.clientHeight };
        map.current = new k.Map(el.current, { center: new k.LatLng(p?.lat ?? 37.28, p?.lng ?? 127.01), level: p?.level ?? 7 });
        position.current = { lat: p?.lat ?? 37.28, lng: p?.lng ?? 127.01, level: p?.level ?? 7 };
        k.event.addListener(map.current, "idle", rememberPosition);
        setReady(true);
      })).catch(() => setError("지도를 불러오지 못했어요. 연결을 확인하거나 리스트로 봐 주세요."));
    return () => { cancelled = true; };
  }, [apiKey]);
  useEffect(() => {
    if (!ready) return;
    const k = window.kakao.maps;
    markers.current.forEach((m) => m.overlay.setMap(null));
    markers.current = places.map((p) => {
      const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}${p.id === selectedId ? " active" : ""}`;
      button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
      button.id = `map-place-${p.id}`;
      const dot = document.createElement("i"); dot.className = "mark";
      const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
      button.onclick = () => pick.current(p.id);
      const marker = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: button, xAnchor: 0, yAnchor: 0, zIndex: p.id === selectedId ? 5 : 1 });
      marker.setMap(map.current); return { id: p.id, button, overlay: marker };
    });
  }, [places, ready]);
  useEffect(() => {
    for (const marker of markers.current) {
      marker.button.classList.toggle("active", marker.id === selectedId);
      marker.overlay.setZIndex(marker.id === selectedId ? 5 : 1);
    }
  }, [selectedId, places, ready]);
  useEffect(() => {
    if (!ready) return;
    if (!fitted.current && places.length && active) {
      showSaved();
      fitted.current = true;
    }
  }, [places, ready, active]);
  useEffect(() => {
    if (ready && active) relayout();
  }, [ready, active]);
  useEffect(() => {
    if (!ready || !el.current) return;
    const observer = new ResizeObserver(() => {
      relayout();
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
  useEffect(() => {
    if (!ready || !active || !viewRequest || appliedRequest.current === viewRequest.sequence) return;
    if (viewRequest.kind === "saved" && !places.length) return;
    appliedRequest.current = viewRequest.sequence;
    if (viewRequest.kind === "saved") showSaved();
    else {
      map.current.setLevel(4);
      map.current.setCenter(new window.kakao.maps.LatLng(viewRequest.lat, viewRequest.lng));
      rememberPosition();
    }
  }, [ready, active, viewRequest, places]);
  return <><div ref={el} className="map-canvas" aria-label="저장한 장소 지도" />{error && <div className="map-notice" role="status">{error}</div>}</>;
}
