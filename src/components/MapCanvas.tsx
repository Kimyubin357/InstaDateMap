"use client";
import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/map-sdk";
import "@/app/map-recovery.css";
import { STATUS_LABEL } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
import { animateMapCenter } from "@/lib/map-motion";
import { CLUSTER_MIN_LEVEL, regionCards, stackCards, zoomInLevel, type RegionCard } from "@/lib/map-clusters";
import { administrativeRegion, MapRegionCache, regionPointKey, type RegionDocument, type RegionPoint } from "@/lib/map-regions";
export interface MapPosition { lat: number; lng: number; level: number }
/** A failed interactive map reports here so the map screen can show it with the other map states. */
export interface MapRecovery { loading: boolean; retry?: () => void }
export type MapViewRequest = { sequence: number; kind: "saved" } | { sequence: number; kind: "place"; lat: number; lng: number; smooth?: boolean; level?: number }
  | { sequence: number; kind: "bounds"; points: { lat: number; lng: number }[] };
export interface MapInsets { top: number; right: number; bottom: number; left: number }
/** A neighbourhood card opens its place list; the map then fits those places beside the list. */
export interface RegionSelection { label: string | null; ids: string[] }
declare global { interface Window { kakao: any; instgrm?: { Embeds: { process: () => void } } } }

/** A card holding the selected place stays above every stacked card. */
const SELECTED_Z = 100000;

function regionCardButton(card: RegionCard<PlaceView>) {
  const button = document.createElement("button"); button.type = "button"; button.className = `region-card${card.label ? "" : " is-unnamed"}`;
  const single = card.places.length === 1;
  const where = card.label || "이 지역";
  button.setAttribute("aria-label", `${where} 가고 싶음 ${card.wish}곳, 지도에 ${card.places.length}곳, 지역 전체 ${card.total}곳 중 ${card.visited}곳 다녀옴${card.fresh ? `, 새 장소 ${card.fresh}곳` : ""}. ${single ? "장소 카드 보기" : card.tier === "local" ? "장소 목록 보기" : "지도 확대"}`);
  if (card.label) { const name = document.createElement("span"); name.className = "region-card-name"; name.textContent = card.label; button.append(name); }
  const count = document.createElement("strong"); count.className = "region-card-count"; count.textContent = card.wish.toLocaleString("ko-KR"); button.append(count);
  if (card.fresh) {
    const badge = document.createElement("span"); badge.className = "region-card-new";
    const word = document.createElement("b"); word.textContent = "NEW";
    badge.append(word, document.createTextNode(` ${card.fresh}`)); button.append(badge);
  }
  const track = document.createElement("span"); track.className = "region-card-progress";
  const fill = document.createElement("i"); fill.style.width = `${card.total ? Math.round(card.visited / card.total * 100) : 0}%`;
  track.append(fill); button.append(track);
  for (const node of button.children) node.setAttribute("aria-hidden", "true");
  return button;
}

function placeButton(p: PlaceView, interactive: boolean, isNew = false) {
  const button = document.createElement("button"); button.type = "button"; button.className = `pin ${p.status}`;
  button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}`);
  button.id = `${interactive ? "map" : "preview"}-place-${p.id}`;
  const dot = document.createElement("i"); dot.className = "mark";
  const label = document.createElement("span"); label.textContent = p.name; button.append(dot, label);
  if (isNew) {
    const badge = document.createElement("span"); badge.className = "new-place-badge"; badge.textContent = "NEW";
    badge.setAttribute("aria-hidden", "true"); button.append(badge);
    button.setAttribute("aria-label", `${p.name}, ${STATUS_LABEL[p.status]}, 새로 등록한 장소`);
  }
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

export default function MapCanvas({ places, selectedId, apiKey, active, initialPosition, onPosition, onPick, onBlank, location, viewRequest, interactive = true, focusPadding, onShowList, newPlaceIds, onRecovery, allPlaces, onRegionOpen, fitPadding }: {
  places: PlaceView[]; selectedId: string | null; apiKey: string; active: boolean; initialPosition?: MapPosition;
  onPosition: (p: MapPosition) => void; onPick: (id: string) => void; location: { lat: number; lng: number } | null;
  viewRequest: MapViewRequest | null;
  onBlank?: () => void; interactive?: boolean;
  focusPadding?: () => { top: number; bottom: number } | null;
  onShowList?: () => void; newPlaceIds?: ReadonlySet<string>;
  onRecovery?: (state: MapRecovery | null) => void;
  /** Every saved place, filters ignored: region progress counts them all. */
  allPlaces?: PlaceView[];
  onRegionOpen?: (selection: RegionSelection) => void;
  fitPadding?: () => MapInsets | null;
}) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null);
  const markers = useRef<{ ids: string[]; button: HTMLButtonElement; overlay: any; z: number }[]>([]); const me = useRef<any>(null);
  const [level, setLevel] = useState(initialPosition?.level ?? 7);
  const pendingMarkerFocus = useRef<string[] | undefined>(undefined);
  const [regions] = useState(() => new MapRegionCache());
  const [regionVersion, setRegionVersion] = useState(0);
  const [lookupRetry, setLookupRetry] = useState(0);
  const regionSource = allPlaces ?? places;
  const coordinateKey = regionSource.map(regionPointKey).sort().join("|");
  const position = useRef(initialPosition); const onMove = useRef(onPosition); onMove.current = onPosition;
  const pick = useRef(onPick); pick.current = onPick;
  const blank = useRef(onBlank); blank.current = onBlank;
  const openRegion = useRef(onRegionOpen); openRegion.current = onRegionOpen;
  const fitInsets = useRef(fitPadding); fitInsets.current = fitPadding;
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
  const recovery = useRef(onRecovery); recovery.current = onRecovery;
  useEffect(() => {
    recovery.current?.(error ? { loading, retry: apiKey ? () => setLoadAttempt((attempt) => attempt + 1) : undefined } : null);
  }, [error, loading, apiKey]);
  useEffect(() => () => recovery.current?.(null), []);
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
  /** Fit the points; with `atMost`, never stay wider than that level and zoom in around their centre instead. */
  function fitPoints(points: { lat: number; lng: number }[], atMost?: number) {
    if (!points.length) return;
    const k = window.kakao.maps, insets = fitInsets.current?.() ?? { top: 120, right: 90, bottom: 125, left: 90 };
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    if (Math.max(...lats) - Math.min(...lats) < 1e-6 && Math.max(...lngs) - Math.min(...lngs) < 1e-6) {
      map.current.setLevel(CLUSTER_MIN_LEVEL - 1); map.current.setCenter(new k.LatLng(points[0].lat, points[0].lng));
    } else {
      const bounds = new k.LatLngBounds(); points.forEach((p) => bounds.extend(new k.LatLng(p.lat, p.lng)));
      map.current.setBounds(bounds, insets.top, insets.right, insets.bottom, insets.left);
      // A few places a street apart must not dive to Kakao's closest level; name pins (level 3) are enough.
      if (map.current.getLevel() < CLUSTER_MIN_LEVEL - 1) map.current.setLevel(CLUSTER_MIN_LEVEL - 1);
    }
    if (atMost !== undefined && map.current.getLevel() > atMost && el.current) {
      // Wide areas (서울 전체) would otherwise refit to the same or a wider level and look unresponsive.
      const centre = new k.LatLng(lats.reduce((a, b) => a + b, 0) / lats.length, lngs.reduce((a, b) => a + b, 0) / lngs.length);
      map.current.setLevel(atMost); map.current.setCenter(centre);
      const { clientWidth: width, clientHeight: height } = el.current, at = map.current.getProjection().containerPointFromCoords(centre);
      const shift = new k.Point(width / 2 + at.x - (insets.left + width - insets.right) / 2, height / 2 + at.y - (insets.top + height - insets.bottom) / 2);
      map.current.setCenter(map.current.getProjection().coordsFromContainerPoint(shift));
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
    const points = [...new Map(regionSource.map((p) => [regionPointKey(p), { lat: p.lat, lng: p.lng }])).values()];
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
    const displayLevel = interactive ? map.current.getLevel() : 0;
    if (displayLevel >= CLUSTER_MIN_LEVEL) {
      // Zoomed out: one card per administrative area (docs/redesign/map-home-compare.md).
      const cards = regionCards(places, (p) => projection.containerPointFromCoords(new k.LatLng(p.lat, p.lng)), {
        level: displayLevel, region: (p) => regions.get(p), isNew: (p) => !!newPlaceIds?.has(p.id), allPlaces,
      });
      // Back to front: cards with more places are drawn over the ones they overlap.
      markers.current = stackCards(cards).map((card, order) => {
        const button = regionCardButton(card), z = 10 + order;
        const point = projection.coordsFromContainerPoint(new k.Point(card.x, card.y));
        const ids = card.places.map((place) => place.id);
        button.classList.toggle("active", ids.includes(focused.current || ""));
        button.onclick = (event) => {
          k.event.preventMap(); cancelMotion.current?.(); moving.current = false; framedPlace.current = undefined;
          if (card.places.length === 1) { pick.current(card.places[0].id); return; }
          if (card.tier === "local" && openRegion.current) { openRegion.current({ label: card.label, ids }); return; }
          if (event.detail === 0) pendingMarkerFocus.current = ids;
          fitPoints(card.places, zoomInLevel(card, (p) => regions.get(p)));
        };
        const overlay = new k.CustomOverlay({ position: point, content: button, xAnchor: 0, yAnchor: 0, zIndex: ids.includes(focused.current || "") ? SELECTED_Z : z });
        overlay.setMap(map.current); return { ids, button, overlay, z };
      });
    } else {
      markers.current = [...new Map(places.map((p) => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id)).map((p) => {
        const button = placeButton(p, interactive, newPlaceIds?.has(p.id));
        button.classList.toggle("active", p.id === focused.current);
        button.onclick = () => { k.event.preventMap(); if (interactive) pick.current(p.id); };
        const marker = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: button, xAnchor: 0, yAnchor: 0, zIndex: p.id === selectedId ? 5 : 1 });
        marker.setMap(map.current); return { ids: [p.id], button, overlay: marker, z: 1 };
      });
    }
    if (previousFocus) markers.current.find((marker) => marker.ids.some((id) => previousFocus.includes(id)))?.button.focus({ preventScroll: true });
    pendingMarkerFocus.current = undefined;
  }, [places, allPlaces, ready, level, interactive, regions, regionVersion, newPlaceIds]);
  useEffect(() => {
    for (const marker of markers.current) {
      const selected = marker.ids.includes(selectedId || "");
      marker.button.classList.toggle("active", selected);
      marker.overlay.setZIndex(selected ? (marker.z > 1 ? SELECTED_Z : 5) : marker.z);
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
    else if (viewRequest.kind === "bounds") { framedPlace.current = undefined; fitPoints(viewRequest.points); }
    else {
      const k = window.kakao.maps;
      framedPlace.current = viewRequest;
      // Selecting one place must leave the count-marker range, including when already at level 4.
      const targetLevel = viewRequest.level ?? (CLUSTER_MIN_LEVEL - 1);
      if (viewRequest.smooth) {
        const center = map.current.getCenter();
        if (map.current.getLevel() > targetLevel) map.current.setLevel(targetLevel);
        const destination = placeCenter(viewRequest), target = { lat: destination.getLat(), lng: destination.getLng() };
        moving.current = true;
        cancelMotion.current = animateMapCenter({ lat: center.getLat(), lng: center.getLng() }, target, (point) => {
          map.current.setCenter(new k.LatLng(point.lat, point.lng));
          if (point === target) { moving.current = false; rememberPosition(); }
        }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 440);
      } else { map.current.setLevel(targetLevel); map.current.setCenter(placeCenter(viewRequest)); rememberPosition(); }
    }
  }, [ready, active, viewRequest, places]);
  return <><div ref={el} className="map-canvas" aria-label={interactive ? "저장한 장소 지도" : "장소 위치 미리보기"} />{error && !onRecovery && <div className={`map-recovery${interactive ? "" : " map-recovery-preview"}`} aria-busy={loading}>
    <p role="status">{loading ? "지도를 다시 불러오는 중…" : error}</p>
    {interactive && !loading && <p className="map-recovery-hint">연결을 확인하고 다시 시도해 주세요.</p>}
    <div className="map-recovery-actions">{apiKey && <button className="btn" disabled={loading} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{interactive ? "지도 다시 불러오기" : "다시 시도"}</button>}
      {interactive && onShowList && <button className="text-btn" onClick={onShowList}>리스트로 보기</button>}</div>
  </div>}</>;
}
