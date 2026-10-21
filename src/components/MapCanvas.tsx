"use client";
import { useEffect, useRef, useState } from "react";
import { loadScript } from "@/lib/scripts";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
import { animateMapCenter } from "@/lib/map-motion";
export interface MapPosition { lat: number; lng: number; level: number }
export type MapViewRequest = { sequence: number; kind: "saved" } | { sequence: number; kind: "place"; lat: number; lng: number; smooth?: boolean };
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }
export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, onBlank, location, viewRequest, interactive = true, focusPadding }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
  viewRequest: MapViewRequest | null;
  onBlank?: () => void; interactive?: boolean;
  focusPadding?: () => { top: number; bottom: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null);
  const markers = useRef<{ id: string; button: HTMLButtonElement; overlay: any }[]>([]); const me = useRef<any>(null);
  const position = useRef(initialPosition); const onMove = useRef(onPosition); onMove.current = onPosition;
  const pick = useRef(onPick); pick.current = onPick;
  const blank = useRef(onBlank); blank.current = onBlank;
  const cancelMotion = useRef<() => void>();
  const moving = useRef(false);
  const padding = useRef(focusPadding); padding.current = focusPadding;
  const focused = useRef(selectedId); focused.current = selectedId;
  const framedPlace = useRef<{ lat: number; lng: number }>();
  const fitted = useRef(!!initialPosition); const [ready, setReady] = useState(false); const [error, setError] = useState("");
  const appliedRequest = useRef<number>();
  const layoutSize = useRef({ width: 0, height: 0 });
  function placeCenter(point: { lat: number; lng: number }) {
    const k = window.kakao.maps, target = new k.LatLng(point.lat, point.lng), insets = padding.current?.();
    if (!insets || !el.current) return target;
    const projection = map.current.getProjection(), pixel = projection.containerPointFromCoords(target);
    const visibleMiddle = (insets.top + el.current.clientHeight - insets.bottom) / 2;
    return projection.coordsFromContainerPoint(new k.Point(pixel.x, pixel.y + el.current.clientHeight / 2 - visibleMiddle));
  }
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
    map.current.relayout(); map.current.setCenter(framedPlace.current && focused.current && !moving.current ? placeCenter(framedPlace.current) : center); rememberPosition();
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
    let cleanup = () => {};
    if (!apiKey) { setError("지도를 준비하지 못했어요. 잠시 리스트로 확인해 주세요."); return; }
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false`, "kakao-sdk")
      .then(() => window.kakao.maps.load(() => {
        if (cancelled || !el.current || map.current) return;
        const k = window.kakao.maps; const p = position.current;
        layoutSize.current = { width: el.current.clientWidth, height: el.current.clientHeight };
        map.current = new k.Map(el.current, { center: new k.LatLng(p?.lat ?? 37.28, p?.lng ?? 127.01), level: p?.level ?? 7, draggable: interactive, scrollwheel: interactive, disableDoubleClickZoom: !interactive });
        if (!interactive) map.current.setZoomable(false);
        position.current = { lat: p?.lat ?? 37.28, lng: p?.lng ?? 127.01, level: p?.level ?? 7 };
        const onBlank = () => blank.current?.();
        const onDrag = () => { cancelMotion.current?.(); moving.current = false; framedPlace.current = undefined; };
        k.event.addListener(map.current, "idle", rememberPosition);
        k.event.addListener(map.current, "click", onBlank);
        k.event.addListener(map.current, "dragstart", onDrag);
        cleanup = () => {
          k.event.removeListener(map.current, "idle", rememberPosition); k.event.removeListener(map.current, "click", onBlank); k.event.removeListener(map.current, "dragstart", onDrag);
          markers.current.forEach((marker) => marker.overlay.setMap(null)); me.current?.setMap(null);
        };
        setReady(true);
      })).catch(() => setError("지도를 불러오지 못했어요. 연결을 확인하거나 리스트로 봐 주세요."));
    return () => { cancelled = true; cancelMotion.current?.(); cleanup(); };
  }, [apiKey]);
  useEffect(() => {
    if (!ready) return;
    const k = window.kakao.maps;
    markers.current.forEach((m) => m.overlay.setMap(null));
    markers.current = places.map((p) => {
      const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}${p.id === selectedId ? " active" : ""}`;
      button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
      button.id = `${interactive ? "map" : "preview"}-place-${p.id}`;
      const dot = document.createElement("i"); dot.className = "mark";
      const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
      if (!interactive) { button.tabIndex = -1; button.setAttribute("aria-hidden", "true"); }
      button.onclick = () => { k.event.preventMap(); if (interactive) pick.current(p.id); };
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
    if (!active) { if (moving.current) appliedRequest.current = undefined; cancelMotion.current?.(); moving.current = false; }
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
    cancelMotion.current?.();
    moving.current = false;
    framedPlace.current = undefined;
    const k = window.kakao.maps; const p = new k.LatLng(location.lat, location.lng);
    if (!me.current) { const content = document.createElement("div"); content.className = "me-dot"; content.setAttribute("aria-label", "내 위치"); me.current = new k.CustomOverlay({ position: p, content, zIndex: 2 }); me.current.setMap(map.current); }
    else me.current.setPosition(p);
    map.current.panTo(p);
  }, [ready, location]);
  useEffect(() => {
    if (!ready || !active || !viewRequest || appliedRequest.current === viewRequest.sequence) return;
    if (viewRequest.kind === "saved" && !places.length) return;
    appliedRequest.current = viewRequest.sequence;
    cancelMotion.current?.();
    moving.current = false;
    if (viewRequest.kind === "saved") { framedPlace.current = undefined; showSaved(); }
    else {
      const k = window.kakao.maps;
      framedPlace.current = viewRequest;
      if (viewRequest.smooth) {
        const center = map.current.getCenter();
        if (map.current.getLevel() > 4) map.current.setLevel(4);
        const destination = placeCenter(viewRequest), target = { lat: destination.getLat(), lng: destination.getLng() };
        moving.current = true;
        cancelMotion.current = animateMapCenter({ lat: center.getLat(), lng: center.getLng() }, target, (point) => {
          map.current.setCenter(new k.LatLng(point.lat, point.lng));
          if (point === target) { moving.current = false; rememberPosition(); }
        }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 440);
      } else { map.current.setLevel(4); map.current.setCenter(placeCenter(viewRequest)); rememberPosition(); }
    }
  }, [ready, active, viewRequest, places]);
  return <><div ref={el} className="map-canvas" aria-label={interactive ? "저장한 장소 지도" : "장소 위치 미리보기"} />{error && <div className="map-notice" role="status">{error}</div>}</>;
}
