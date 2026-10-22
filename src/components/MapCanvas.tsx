"use client";
import { useEffect, useRef, useState } from "react";
import { loadScript } from "@/lib/scripts";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
import { animateMapCenter } from "@/lib/map-motion";
import { CLUSTER_MIN_LEVEL, clusterPlaces } from "@/lib/map-clusters";
export interface MapPosition { lat: number; lng: number; level: number }
export type MapViewRequest = { sequence: number; kind: "saved" } | { sequence: number; kind: "place"; lat: number; lng: number; smooth?: boolean };
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }

function clusterButton(total: number, visited: number) {
  const button = document.createElement("button"); button.type = "button"; button.className = "cluster-pin";
  button.dataset.total = String(total); button.dataset.visited = String(visited);
  button.setAttribute("aria-label", `저장한 장소 ${total}곳, 가본 곳 ${visited}곳. 지도 확대`);
  button.title = `저장 ${total}곳 · 방문 ${visited}/${total} · 눌러서 확대`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 56 56"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  for (const kind of ["track", "progress"]) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    for (const [key, value] of Object.entries({ cx: "28", cy: "28", r: "24", pathLength: "100", class: `cluster-ring-${kind}` })) circle.setAttribute(key, value);
    if (kind === "progress") { circle.setAttribute("stroke-dasharray", `${visited / total * 100} 100`); circle.setAttribute("transform", "rotate(-90 28 28)"); }
    svg.append(circle);
  }
  const count = document.createElement("span"); count.textContent = total.toLocaleString("ko-KR"); count.setAttribute("aria-hidden", "true");
  if (total > 99) button.classList.add("cluster-pin-large");
  button.append(svg, count);
  return button;
}

export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, onBlank, location, viewRequest, interactive = true, focusPadding }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
  viewRequest: MapViewRequest | null;
  onBlank?: () => void; interactive?: boolean;
  focusPadding?: () => { top: number; bottom: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null);
  const markers = useRef<{ ids: string[]; button: HTMLButtonElement; overlay: any }[]>([]); const me = useRef<any>(null);
  const [level, setLevel] = useState(initialPosition?.level ?? 7);
  const pendingMarkerFocus = useRef<string[]>();
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
        const onZoom = () => setLevel(map.current.getLevel());
        k.event.addListener(map.current, "idle", rememberPosition);
        k.event.addListener(map.current, "click", onBlank);
        k.event.addListener(map.current, "dragstart", onDrag);
        k.event.addListener(map.current, "zoom_changed", onZoom);
        cleanup = () => {
          k.event.removeListener(map.current, "idle", rememberPosition); k.event.removeListener(map.current, "click", onBlank); k.event.removeListener(map.current, "dragstart", onDrag);
          k.event.removeListener(map.current, "zoom_changed", onZoom);
          markers.current.forEach((marker) => marker.overlay.setMap(null)); me.current?.setMap(null);
        };
        setReady(true);
      })).catch(() => setError("지도를 불러오지 못했어요. 연결을 확인하거나 리스트로 봐 주세요."));
    return () => { cancelled = true; cancelMotion.current?.(); cleanup(); };
  }, [apiKey]);
  useEffect(() => {
    if (!ready) return;
    const k = window.kakao.maps;
    const previousFocus = pendingMarkerFocus.current || markers.current.find((marker) => marker.button === document.activeElement)?.ids;
    markers.current.forEach((m) => m.overlay.setMap(null));
    if (interactive && map.current.getLevel() >= CLUSTER_MIN_LEVEL) {
      const projection = map.current.getProjection();
      markers.current = clusterPlaces(places, (place) => projection.containerPointFromCoords(new k.LatLng(place.lat, place.lng))).map((group) => {
        const button = clusterButton(group.places.length, group.visited);
        const point = projection.coordsFromContainerPoint(new k.Point(group.x, group.y));
        const ids = group.places.map((place) => place.id);
        button.classList.toggle("active", ids.includes(focused.current || ""));
        button.onclick = (event) => {
          k.event.preventMap(); cancelMotion.current?.(); moving.current = false; framedPlace.current = undefined;
          if (event.detail === 0) pendingMarkerFocus.current = ids;
          map.current.setLevel(Math.max(4, map.current.getLevel() - 2), { anchor: point, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
        };
        const overlay = new k.CustomOverlay({ position: point, content: button, xAnchor: 0, yAnchor: 0, zIndex: ids.includes(focused.current || "") ? 5 : 1 });
        overlay.setMap(map.current); return { ids, button, overlay };
      });
    } else {
      markers.current = places.map((p) => {
        const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}${p.id === selectedId ? " active" : ""}`;
        button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
        button.id = `${interactive ? "map" : "preview"}-place-${p.id}`;
        const dot = document.createElement("i"); dot.className = "mark";
        const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
        if (!interactive) { button.tabIndex = -1; button.setAttribute("aria-hidden", "true"); }
        button.onclick = () => { k.event.preventMap(); if (interactive) pick.current(p.id); };
        const marker = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: button, xAnchor: 0, yAnchor: 0, zIndex: p.id === selectedId ? 5 : 1 });
        marker.setMap(map.current); return { ids: [p.id], button, overlay: marker };
      });
    }
    if (previousFocus) markers.current.find((marker) => marker.ids.some((id) => previousFocus.includes(id)))?.button.focus({ preventScroll: true });
    pendingMarkerFocus.current = undefined;
  }, [places, ready, level, interactive]);
  useEffect(() => {
    for (const marker of markers.current) {
      const selected = marker.ids.includes(selectedId || "");
      marker.button.classList.toggle("active", selected);
      marker.overlay.setZIndex(selected ? 5 : 1);
    }
  }, [selectedId, places, ready, level]);
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
