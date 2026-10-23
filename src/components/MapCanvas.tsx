"use client";
import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/map-sdk";
import "@/app/map-recovery.css";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
import { animateMapCenter } from "@/lib/map-motion";
import { CLUSTER_MIN_LEVEL, clusterPlaces } from "@/lib/map-clusters";
import { administrativeRegion, MapRegionCache, regionPointKey, type RegionDocument, type RegionPoint } from "@/lib/map-regions";
export interface MapPosition { lat: number; lng: number; level: number }
export type MapViewRequest = { sequence: number; kind: "saved" } | { sequence: number; kind: "place"; lat: number; lng: number; smooth?: boolean };
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }

function clusterButton(total: number, visited: number, region: string | null) {
  const button = document.createElement("button"); button.type = "button"; button.className = "cluster-pin";
  button.dataset.total = String(total); button.dataset.visited = String(visited);
  button.setAttribute("aria-label", `${region || ""} 저장한 장소 ${total}곳, 가본 곳 ${visited}곳. 지도 확대`);
  button.title = `${region || ""} · 저장 ${total}곳 · 방문 ${visited}/${total} · 눌러서 확대`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 56 56"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const circle = document.createElementNS(svg.namespaceURI, "circle");
  for (const [key, value] of Object.entries({ cx: "28", cy: "28", r: "24", pathLength: "100", class: "cluster-ring-progress",
    "stroke-dasharray": `${visited / total * 100} 100`, transform: "rotate(-90 28 28)" })) circle.setAttribute(key, value);
  svg.append(circle);
  const count = document.createElement("span"); count.textContent = total.toLocaleString("ko-KR"); count.setAttribute("aria-hidden", "true");
  if (total > 99) button.classList.add("cluster-pin-large");
  button.append(svg, count);
  return button;
}

function placeButton(p: PlaceView, interactive: boolean) {
  const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}`;
  button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
  button.id = `${interactive ? "map" : "preview"}-place-${p.id}`;
  const dot = document.createElement("i"); dot.className = "mark";
  const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
  if (!interactive) { button.tabIndex = -1; button.setAttribute("aria-hidden", "true"); }
  return button;
}

function lookupRegion(services: any, point: RegionPoint) {
  return new Promise<ReturnType<typeof administrativeRegion>>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    try {
      new services.Geocoder().coord2RegionCode(point.lng, point.lat, (documents: RegionDocument[], status: string) => {
        clearTimeout(timer); resolve(status === services.Status.OK ? administrativeRegion(documents) : null);
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}

export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, onBlank, location, viewRequest, interactive = true, focusPadding, onShowList }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
  viewRequest: MapViewRequest | null;
  onBlank?: () => void; interactive?: boolean;
  focusPadding?: () => { top: number; bottom: number } | null;
  onShowList?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null);
  const markers = useRef<{ ids: string[]; button: HTMLButtonElement; overlay: any }[]>([]); const me = useRef<any>(null);
  const [level, setLevel] = useState(initialPosition?.level ?? 7);
  const pendingMarkerFocus = useRef<string[] | undefined>(undefined);
  const [regions] = useState(() => new MapRegionCache());
  const [regionVersion, setRegionVersion] = useState(0);
  const [lookupRetry, setLookupRetry] = useState(0);
  const coordinateKey = places.map(regionPointKey).sort().join("|");
  const position = useRef(initialPosition); const onMove = useRef(onPosition); onMove.current = onPosition;
  const pick = useRef(onPick); pick.current = onPick;
  const blank = useRef(onBlank); blank.current = onBlank;
  const cancelMotion = useRef<(() => void) | undefined>(undefined);
  const moving = useRef(false);
  const padding = useRef(focusPadding); padding.current = focusPadding;
  const focused = useRef(selectedId); focused.current = selectedId;
  const framedPlace = useRef<{ lat: number; lng: number } | undefined>(undefined);
  const fitted = useRef(!!initialPosition); const [ready, setReady] = useState(false); const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0); const [loading, setLoading] = useState(true);
  const automaticRetryUsed = useRef(false);
  const [onlineVersion, setOnlineVersion] = useState(0);
  const latestOnlineVersion = useRef(0); const attemptOnlineVersion = useRef(0);
  const appliedRequest = useRef<number | undefined>(undefined);
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
    // Keep reconnects that arrive while the SDK is loading or this map is hidden.
    const rememberReconnect = () => setOnlineVersion(++latestOnlineVersion.current);
    window.addEventListener("online", rememberReconnect);
    return () => window.removeEventListener("online", rememberReconnect);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    attemptOnlineVersion.current = latestOnlineVersion.current;
    setLoading(true); setReady(false);
    if (!apiKey) { setLoading(false); setError("지도를 준비하지 못했어요."); return; }
    loadKakaoMaps(apiKey)
      .then((k) => {
        if (cancelled || !el.current || map.current) return;
        const p = position.current;
        layoutSize.current = { width: el.current.clientWidth, height: el.current.clientHeight };
        const instance = new k.Map(el.current, { center: new k.LatLng(p?.lat ?? 37.28, p?.lng ?? 127.01), level: p?.level ?? 7, draggable: interactive, scrollwheel: interactive, disableDoubleClickZoom: !interactive });
        map.current = instance;
        position.current = { lat: p?.lat ?? 37.28, lng: p?.lng ?? 127.01, level: p?.level ?? 7 };
        const onBlank = () => blank.current?.();
        const onDrag = () => { cancelMotion.current?.(); moving.current = false; framedPlace.current = undefined; };
        const onZoom = () => setLevel(instance.getLevel());
        cleanup = () => {
          k.event.removeListener(instance, "idle", rememberPosition); k.event.removeListener(instance, "click", onBlank); k.event.removeListener(instance, "dragstart", onDrag);
          k.event.removeListener(instance, "zoom_changed", onZoom);
          markers.current.forEach((marker) => marker.overlay.setMap(null)); me.current?.setMap(null);
          markers.current = []; me.current = null; map.current = null;
          el.current?.replaceChildren();
        };
        if (!interactive) instance.setZoomable(false);
        k.event.addListener(instance, "idle", rememberPosition);
        k.event.addListener(instance, "click", onBlank);
        k.event.addListener(instance, "dragstart", onDrag);
        k.event.addListener(instance, "zoom_changed", onZoom);
        setLevel(instance.getLevel()); setError(""); setLoading(false); setReady(true);
      }).catch(() => {
        if (cancelled) return;
        cleanup(); setLoading(false); setError("지도를 불러오지 못했어요.");
      });
    return () => { cancelled = true; cancelMotion.current?.(); cleanup(); };
  }, [apiKey, loadAttempt]);
  useEffect(() => {
    if (ready || loading || !error || !apiKey || !active || automaticRetryUsed.current
      || onlineVersion <= attemptOnlineVersion.current || navigator.onLine === false) return;
    automaticRetryUsed.current = true;
    setLoadAttempt((attempt) => attempt + 1);
  }, [ready, loading, error, apiKey, active, onlineVersion]);
  useEffect(() => {
    if (!ready || !interactive || !active || level < CLUSTER_MIN_LEVEL) return;
    let cancelled = false; let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const points = [...new Map(places.map((p) => [regionPointKey(p), { lat: p.lat, lng: p.lng }])).values()];
    async function run() {
      const missing = points.filter((p) => regions.get(p) === undefined);
      for (let i = 0; i < missing.length && !cancelled; i += 4) {
        await Promise.all(missing.slice(i, i + 4).map((p) => regions.resolve(p, (point) => lookupRegion(window.kakao.maps.services, point))));
        if (!cancelled) setRegionVersion((v) => v + 1);
      }
      if (cancelled) return;
      // Also repaint cache results resolved while this map was hidden.
      if (!missing.length) setRegionVersion((v) => v + 1);
      if (points.some((p) => !regions.get(p))) retryTimer = setTimeout(() => setLookupRetry((v) => v + 1), 60_000);
    }
    void run();
    const retry = () => setLookupRetry((v) => v + 1);
    window.addEventListener("online", retry);
    return () => { cancelled = true; clearTimeout(retryTimer); window.removeEventListener("online", retry); };
  }, [ready, interactive, active, coordinateKey, level, lookupRetry, regions]);
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled) setRegionVersion((v) => v + 1); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const k = window.kakao.maps;
    const previousFocus = pendingMarkerFocus.current || markers.current.find((marker) => marker.button === document.activeElement)?.ids;
    markers.current.forEach((m) => m.overlay.setMap(null));
    const projection = map.current.getProjection();
    const buttons = new Map(places.map((p) => [p.id, placeButton(p, interactive)]));
    // Batch layout reads: use the actual font/nameplate dimensions, not an 80px radius.
    const measure = document.createElement("div");
    measure.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:flex-start;visibility:hidden;pointer-events:none";
    for (const button of buttons.values()) measure.append(button);
    el.current!.parentElement!.append(measure);
    const sizes = new Map([...buttons].map(([id, button]) => [id, { width: button.offsetWidth, height: button.offsetHeight }]));
    measure.remove();
    const groups = clusterPlaces(places, (p) => projection.containerPointFromCoords(new k.LatLng(p.lat, p.lng)), {
      level: interactive ? map.current.getLevel() : 0, region: (p) => regions.get(p), size: (p) => sizes.get(p.id)!,
    });
    markers.current = groups.map((group) => {
      if (group.places.length > 1) {
        const button = clusterButton(group.places.length, group.visited, group.region);
        const point = projection.coordsFromContainerPoint(new k.Point(group.x, group.y));
        const ids = group.places.map((place) => place.id);
        button.classList.toggle("active", ids.includes(focused.current || ""));
        button.onclick = (event) => {
          k.event.preventMap(); cancelMotion.current?.(); moving.current = false; framedPlace.current = undefined;
          if (event.detail === 0) pendingMarkerFocus.current = ids;
          map.current.setLevel(Math.max(3, map.current.getLevel() - 2), { anchor: point, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
        };
        const overlay = new k.CustomOverlay({ position: point, content: button, xAnchor: 0, yAnchor: 0, zIndex: ids.includes(focused.current || "") ? 5 : 1 });
        overlay.setMap(map.current); return { ids, button, overlay };
      } else {
        const p = group.places[0], button = buttons.get(p.id)!;
        button.classList.toggle("active", p.id === focused.current);
        button.onclick = () => { k.event.preventMap(); if (interactive) pick.current(p.id); };
        const marker = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: button, xAnchor: 0, yAnchor: 0, zIndex: p.id === selectedId ? 5 : 1 });
        marker.setMap(map.current); return { ids: [p.id], button, overlay: marker };
      }
    });
    if (previousFocus) markers.current.find((marker) => marker.ids.some((id) => previousFocus.includes(id)))?.button.focus({ preventScroll: true });
    pendingMarkerFocus.current = undefined;
  }, [places, ready, level, interactive, regions, regionVersion]);
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
  return <><div ref={el} className="map-canvas" aria-label={interactive ? "저장한 장소 지도" : "장소 위치 미리보기"} />{error && <div className={`map-recovery${interactive ? "" : " map-recovery-preview"}`} aria-busy={loading}>
    <p role="status">{loading ? "지도를 다시 불러오는 중…" : error}</p>
    {interactive && !loading && <p className="map-recovery-hint">연결을 확인하고 다시 시도해 주세요.</p>}
    <div className="map-recovery-actions">{apiKey && <button className="btn" disabled={loading} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{interactive ? "지도 다시 불러오기" : "다시 시도"}</button>}
      {interactive && onShowList && <button className="text-btn" onClick={onShowList}>리스트로 보기</button>}</div>
  </div>}</>;
}
