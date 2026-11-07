"use client";
import CollectionsList from "@/components/CollectionsList";
import useNewPlaceIds from "@/components/useNewPlaceIds";
import PendingLinks from "@/components/PendingLinks";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SEARCH_TOOLS_ID } from "@/lib/search-tools";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import Modal from "@/components/Modal";
import MapCanvas, { type MapInsets, type MapPosition, type MapRecovery, type MapViewRequest, type RegionSelection } from "@/components/MapCanvas";
import RegionPlacesList from "@/components/RegionPlacesList";
import MapStatus, { useLandscape, type MapStatusContent } from "@/components/MapStatus";
import PlaceSheet from "@/components/PlaceSheet";
import BottomNav from "@/components/BottomNav";
import ShellLink from "@/components/ShellLink";
import PlaceCarousel from "@/components/PlaceCarousel";
import { useBoardState, useBoardSync } from "@/components/BoardProvider";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { DEFAULT_STATUSES, STATUS_ORDER, filterPlaces, sortPlaces, type PlaceView } from "@/lib/place-view";
import { navigateShell } from "@/lib/shell-navigation";
type Overlay = "filters" | "pending" | "place" | null;
const NO_PLACES: PlaceView[] = [];
export default function MapApp({ who, kakaoKey, active, keyboard, onViewChange }: { who: string; kakaoKey: string; active: boolean; keyboard: boolean; onViewChange: (href: string) => void }) {
  const router = useRouter();
  const { store, notify } = useBoardSync(); const { snapshot: data, error, syncing } = useBoardState();
  const places = data?.places || NO_PLACES, pending = data?.pending || []; const board = data?.board || "우리 데이트맵", loaded = !!data;
  const newPlaceIds = useNewPlaceIds(places);
  const navigation = useSearchParams().toString();
  const params = new URLSearchParams(navigation);
  const collectionId = params.get("collection");
  const listMode = params.get("section") === "collections" || collectionId ? "collections" : "all";
  const collection = data?.collections?.find((c) => c.id === collectionId);
  function viewHref(target: "map" | "list") {
    const q = new URLSearchParams(); if (target === "list") q.set("view", "list");
    if (collectionId) q.set("collection", collectionId);
    if (listMode === "collections") q.set("section", "collections");
    return "/" + (q.size ? `?${q}` : "");
  }
  function navigateCollections(mode: "all" | "collections", id?: string) {
    const q = new URLSearchParams({ view: "list" }); if (mode === "collections") q.set("section", "collections"); if (id) q.set("collection", id);
    navigateShell(`/?${q}`);
  }
  useEffect(() => {
    if (loaded && !error && collectionId && data?.collections && !collection) {
      const q = new URLSearchParams(window.location.search); q.delete("collection");
      navigateShell(`/?${q}`, true); notify("이 모음은 삭제되었어요.", "info");
    }
  }, [collectionId, collection, loaded, error, data?.collections, notify]);
  const [view, setView] = useState<"map" | "list">("map");
  useEffect(() => { if (active && new URLSearchParams(navigation).get("from") !== "search") onViewChange(viewHref(view)); }, [active, view, navigation, onViewChange]);
  const [statuses, setStatuses] = useState<PlaceStatus[]>([...DEFAULT_STATUSES]); const [category, setCategory] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mapRequest, setMapRequest] = useState<MapViewRequest | null>(null); const requestSequence = useRef(0);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null); const [mapLocation, setMapLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sort, setSort] = useState("recent"); const [locating, setLocating] = useState(false);
  const [savedArrival, setSavedArrival] = useState<string | null>(null);
  const duplicateArrival = useRef(false);
  const restoredArrival = useRef(false);
  const [initialMap, setInitialMap] = useState<MapPosition>(); const [restored, setRestored] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [searchTools, setSearchTools] = useState<HTMLElement | null>(null);
  const [mapRecovery, setMapRecovery] = useState<MapRecovery | null>(null);
  const [dismissedStatus, setDismissedStatus] = useState<string | null>(null);
  const landscape = useLandscape();
  const [regionSelection, setRegionSelection] = useState<RegionSelection | null>(null);
  useEffect(() => { setSearchTools(document.getElementById(SEARCH_TOOLS_ID)); }, []);
  const listPositions = useRef(new Map<string, number>());
  const listKey = `${listMode}:${collectionId ?? ""}`;
  const root = useRef<HTMLDivElement>(null);
  const mapPosition = useRef<MapPosition | undefined>(undefined); const listScroll = useRef(0); const snapshot = useRef({ statuses, category });
  snapshot.current = { statuses, category };
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("datemap-view") || "null");
      if (saved) {
        if (Array.isArray(saved.statuses)) setStatuses(saved.statuses.filter((s: PlaceStatus) => STATUS_ORDER.includes(s)));
        if (typeof saved.category === "string") setCategory(saved.category);
        if (saved.position && Number.isFinite(saved.position.lat) && Number.isFinite(saved.position.lng)) { setInitialMap(saved.position); mapPosition.current = saved.position; }
        listScroll.current = Number(saved.scroll) || 0;
      }
    } catch { /* A stale local view must not prevent opening the map. */ }
    setRestored(true);
    const saveView = () => { try { sessionStorage.setItem("datemap-view", JSON.stringify({ ...snapshot.current, position: mapPosition.current, scroll: listScroll.current })); } catch {} };
    window.addEventListener("pagehide", saveView);
    return () => { window.removeEventListener("pagehide", saveView); saveView(); };
  }, []);
  useEffect(() => {
    const syncOverlay = () => {
      const params = new URLSearchParams(window.location.search), id = params.get("place");
      if (window.location.pathname !== "/") return;
      setView(params.get("view") === "list" ? "list" : "map");
      setSelectedId(id); setOverlay(id ? "place" : params.get("panel") === "filters" ? "filters" : params.get("panel") === "pending" ? "pending" : null);
    };
    window.addEventListener("popstate", syncOverlay);
    return () => window.removeEventListener("popstate", syncOverlay);
  }, []);
  useEffect(() => {
    if (!active) { setOverlay(null); return; }
    const params = new URLSearchParams(navigation), id = params.get("place");
    setView(params.get("view") === "list" ? "list" : "map");
    if (id) setFocusedId(id);
    setSelectedId(id); setOverlay(id ? "place" : params.get("panel") === "filters" ? "filters" : params.get("panel") === "pending" ? "pending" : null);
    const saved = params.get("saved") || params.get("restored"); setSavedArrival(saved); duplicateArrival.current = params.get("duplicate") === "1"; restoredArrival.current = !!params.get("restored");
    // Successful saves already supply this place. Only old responses / direct URLs need a fetch.
    if (saved && !store.getSnapshot().snapshot?.places.some((p) => p.id === saved)) void store.refresh();
  }, [active, navigation, store]);
  useEffect(() => { if (view === "list" && list.current) list.current.scrollTop = listPositions.current.get(listKey) ?? (listKey === "all:" ? listScroll.current : 0); }, [view, loaded, listKey]);
  function open(kind: Exclude<Overlay, null>, id?: string) {
    const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel");
    if (kind === "place" && id) url.searchParams.set("place", id); else url.searchParams.set("panel", kind);
    history.pushState({ ...history.state, datemapOverlay: true }, "", url.pathname + url.search);
    setSelectedId(id || null); setOverlay(kind);
    if (kind === "place" && id) setFocusedId(id);
  }
  function close() {
    if (new URLSearchParams(window.location.search).get("from") === "search") router.back();
    else if (history.state?.datemapOverlay) history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel"); history.replaceState(history.state, "", url.pathname + url.search); setOverlay(null); setSelectedId(null); }
  }
  const categories = useMemo(() => [...new Set(places.map((p) => p.category).filter((s): s is string => !!s))].sort(), [places]);
  const scopedPlaces = useMemo(() => { if (!collection) return places; const ids = new Set(collection.place_ids); return places.filter((p) => ids.has(p.id)); }, [places, collection]);
  const visible = useMemo(() => sortPlaces(filterPlaces(scopedPlaces, "", statuses, category), sort === "near" ? origin : null), [scopedPlaces, statuses, category, sort, origin]);
  const selected = places.find((p) => p.id === selectedId);
  const searchDetail = new URLSearchParams(navigation).get("from") === "search";
  const mapPlaces = useMemo(() => searchDetail && selected && !visible.some((p) => p.id === selected.id) ? [...visible, selected] : visible, [searchDetail, selected, visible]);
  const focused = mapPlaces.find((place) => place.id === focusedId);
  const regionPlaces = useMemo(() => { if (!regionSelection) return []; const ids = new Set(regionSelection.ids); return mapPlaces.filter((p) => ids.has(p.id)); }, [regionSelection, mapPlaces]);
  // The list follows the current filter; it closes when nothing is left or the map is hidden.
  useEffect(() => { if (regionSelection && (view !== "map" || !active || !regionPlaces.length)) setRegionSelection(null); }, [regionSelection, view, active, regionPlaces.length]);
  // A tap anywhere outside the list closes it; the tapped control still does its own job (another
  // neighbourhood card reopens the list for its area). Dragging the map leaves the list open.
  useEffect(() => {
    if (!regionSelection) return;
    let start: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { start = { x: event.clientX, y: event.clientY }; };
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".region-sheet")) return;
      if (start && event.detail !== 0 && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
      setRegionSelection(null);
    };
    document.addEventListener("pointerdown", down, true); document.addEventListener("click", click, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("click", click, true); };
  }, [regionSelection]);
  // Fit the neighbourhood after the list has laid out, so the places land in the map area beside it.
  useEffect(() => {
    if (!regionSelection) return;
    const frame = requestAnimationFrame(() => setMapRequest({ sequence: ++requestSequence.current, kind: "bounds", points: regionPlaces.map((p) => ({ lat: p.lat, lng: p.lng })) }));
    return () => cancelAnimationFrame(frame);
  }, [regionSelection]);
  useEffect(() => {
    const params = new URLSearchParams(navigation);
    if (!active || !selected || params.get("from") !== "search") return;
    setMapRequest({ sequence: ++requestSequence.current, kind: "place", lat: selected.lat, lng: selected.lng });
  }, [active, navigation, selected?.id]);
  useEffect(() => {
    if (!active || !loaded || !savedArrival) return;
    const place = places.find((p) => p.id === savedArrival);
    if (!place && (syncing || error || !["0", "1"].includes(savedArrival))) return;
    setView("map");
    if (!restoredArrival.current || !visible.some((p) => p.id === place?.id)) { setStatuses(statusesShowing(place)); setCategory(""); }
    setFocusedId(place?.id || null);
    setMapRequest(place ? { sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng, smooth: true, level: 3 } : { sequence: ++requestSequence.current, kind: "saved" });
    if (!restoredArrival.current) notify(savedArrival === "0" ? "저장 없이 링크를 정리했어요." : duplicateArrival.current ? "이미 저장한 장소예요." : "장소를 저장했어요.");
    setSavedArrival(null);
    const url = new URL(window.location.href); url.searchParams.delete("saved"); url.searchParams.delete("duplicate"); url.searchParams.delete("restored"); url.searchParams.delete("view"); url.searchParams.delete("collection"); url.searchParams.delete("section");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [active, loaded, places, savedArrival, syncing, error]);
  function showPlaceOnMap(place: PlaceView) {
    if (!visible.some((p) => p.id === place.id)) { setStatuses(statusesShowing(place)); setCategory(""); }
    setView("map"); setFocusedId(place.id);
    setMapRequest({ sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng });
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "search" && params.get("view") !== "list" && history.state?.datemapOverlay) {
      // The map is already the previous entry; consume the detail entry instead of duplicating it.
      history.back(); setOverlay(null); setSelectedId(null);
    } else if (params.get("from") === "search") {
      history.replaceState(history.state, "", "/"); setOverlay(null); setSelectedId(null);
    } else {
      const url = new URL(window.location.href); url.searchParams.delete("view"); url.searchParams.delete("place"); url.searchParams.delete("panel");
      history.replaceState({ ...history.state, datemapOverlay: false }, "", url.pathname + url.search); setOverlay(null); setSelectedId(null);
    }
  }
  function locate(forSort = false) {
    if (!navigator.geolocation) { notify("이 기기에서는 위치를 확인할 수 없어요.", "info"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => { const value = { lat: p.coords.latitude, lng: p.coords.longitude }; setOrigin(value); if (forSort) setSort("near"); else setMapLocation(value); setLocating(false); },
      () => { setLocating(false); notify("위치를 확인하지 못했어요.", "info"); }, { timeout: 12000, maximumAge: 30000 });
  }
  function reset() { setStatuses([...DEFAULT_STATUSES]); setCategory(""); }
  /** The default filter, widened to every status only when the place itself would stay hidden. */
  function statusesShowing(place?: PlaceView) { return !place || DEFAULT_STATUSES.includes(place.status) ? [...DEFAULT_STATUSES] : [...STATUS_ORDER]; }
  function toggleStatus(status: PlaceStatus) {
    setStatuses((current) => {
      if (!current.length || current.length === STATUS_ORDER.length) return [status];
      if (!current.includes(status)) return [...current, status];
      return current.length === 1 ? [...STATUS_ORDER] : current.filter((value) => value !== status);
    });
  }
  function previewPlace(id: string) {
    const place = mapPlaces.find((item) => item.id === id); if (!place) return;
    setFocusedId(id);
    setMapRequest({ sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng, smooth: true });
  }
  /** Map area left free by search, chips, an open region list and the bottom navigation. */
  function fitPadding(): MapInsets | null {
    const box = root.current?.getBoundingClientRect(); if (!box) return null;
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const stackTop = [...(root.current?.querySelectorAll(".map-chip-stack>:not(.region-sheet):not(.map-status-card)") ?? [])].reduce((bottom, el) => Math.max(bottom, el.getBoundingClientRect().bottom), rect(".unified-search-header")?.bottom ?? box.top + 80);
    const sheet = root.current?.querySelector<HTMLElement>(".region-sheet")?.getBoundingClientRect();
    const nav = rect(".bottom-nav");
    const inset = { top: stackTop - box.top + 24, right: 72, bottom: box.bottom - (nav?.top ?? box.bottom) + 24, left: 40 };
    if (sheet && landscape) inset.left = sheet.right - box.left + 24;
    else if (sheet) inset.bottom = box.bottom - sheet.top + 24;
    return inset;
  }
  function focusPadding() {
    const deck = root.current?.querySelector<HTMLElement>(".place-carousel");
    if (!deck || !root.current) return null;
    const search = document.querySelector(".unified-search-header")?.getBoundingClientRect();
    return { top: (search?.bottom || 80) + 16, bottom: root.current.clientHeight - deck.offsetTop + 10 };
  }
  // Map states (docs/redesign/map-home-compare.md): portrait = centred modal over a dim screen, landscape = left-column card.
  const statusKind = !active || view !== "map" || overlay ? null
    : !loaded && !error ? "loading" : error && !loaded ? "error"
    : mapRecovery ? (mapRecovery.loading ? "map-loading" : "map-error")
    : loaded && !error && visible.length === 0 ? (places.length ? "filtered" : "empty") : null;
  // Closing hides one occurrence; the same situation arising again (or with another filter) shows it again.
  const statusSignature = statusKind ? `${statusKind}:${statusKind === "filtered" ? `${statuses.join(",")}|${category}|${collectionId ?? ""}` : statusKind === "error" ? error : ""}` : "";
  useEffect(() => { setDismissedStatus(null); }, [statusSignature]);
  const status: MapStatusContent | null = !statusKind || dismissedStatus === statusSignature ? null
    : statusKind === "loading" ? { tone: "info", icon: "heart", title: "우리 장소를 불러오는 중…", closable: false }
    : statusKind === "error" ? { tone: "error", icon: "close", title: "장소를 불러오지 못했어요", message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.", closable: true,
      actions: <button type="button" className="btn primary" onClick={() => void store.refresh()}>다시 시도</button> }
    : statusKind === "map-loading" ? { tone: "info", icon: "pin", title: "지도를 다시 불러오는 중…", closable: false }
    : statusKind === "map-error" ? { tone: "error", icon: "close", title: "지도를 불러오지 못했어요", message: "잠시 후 다시 시도하거나, 저장한 장소를 리스트로 볼 수 있어요.", closable: true,
      actions: <>{mapRecovery?.retry && <button type="button" className="btn primary" onClick={mapRecovery.retry}>다시 시도</button>}<button type="button" className="btn" onClick={() => navigateShell(viewHref("list"))}>리스트로 보기</button></> }
    : statusKind === "empty" ? { tone: "info", icon: "heart", title: "우리의 첫 장소를 담아봐요", message: "인스타에서 발견한 곳도, 이미 아는 곳도 좋아요.", closable: true,
      actions: <ShellLink href="/add" className="btn primary">장소 추가</ShellLink> }
    : { tone: "info", icon: "heart", title: "아직 맞는 장소가 없어요", message: "필터를 조금 바꿔볼까요?", closable: true,
      actions: <button type="button" className="btn primary" onClick={reset}>필터 초기화</button> };
  const regionView = regionSelection && regionPlaces.length > 0 && view === "map" && <RegionPlacesList label={regionSelection.label} places={regionPlaces} newPlaceIds={newPlaceIds}
    onClose={() => setRegionSelection(null)} onPick={(id) => { setRegionSelection(null); previewPlace(id); }} />;
  const statusView = status && <MapStatus status={status} landscape={landscape} onClose={() => setDismissedStatus(statusSignature)} />;
  const showPlaceCard = view === "map" && !!focused && !(overlay === "place" && selected);
  const all = statuses.length === STATUS_ORDER.length;
  return <div ref={root} className={`app-root view-${view}${pending.length ? " has-pending-links" : ""}${showPlaceCard ? " has-place-card" : ""}`}>
    <div className={`map-surface ${view === "list" ? "hidden-map" : ""}${mapRecovery && !mapRecovery.loading ? " is-map-failed" : ""}`} aria-hidden={view !== "map"}>{restored && <MapCanvas newPlaceIds={newPlaceIds} places={mapPlaces} selectedId={selectedId || focusedId} apiKey={kakaoKey} active={active && view === "map"} initialPosition={initialMap} onPosition={(p) => { mapPosition.current = p; }} onPick={previewPlace} onBlank={() => { if (!overlay) setFocusedId(null); }} location={mapLocation} viewRequest={mapRequest} focusPadding={focusPadding} onShowList={() => navigateShell(viewHref("list"))} onRecovery={setMapRecovery} allPlaces={places} fitPadding={fitPadding} onRegionOpen={(selection) => { setFocusedId(null); setRegionSelection(selection); }} />}</div>
    <h1 className="sr-only">{board}</h1>
    {view === "map" && searchTools && createPortal(<button className="icon-btn bordered search-filter-btn" aria-label="상세 필터" onClick={() => open("filters")}><Icon name="sliders" />{(category || !all) && <i className="filter-dot" />}</button>, searchTools)}
    <div className="map-chip-stack">
    {pending.length > 0 && <button className="pending-map-badge" onClick={() => open("pending")} aria-label={`마저 확인할 링크 ${pending.length}개`}><Icon name="link" width="16" /><span>확인 대기 {pending.length}</span></button>}
    {/* Next step wires this to the new-place view; for now it only reports the count. */}
    {view === "map" && newPlaceIds.size > 0 && <button type="button" className="new-places-chip" aria-label={`새 장소 ${newPlaceIds.size}곳`}><span className="new-place-badge" aria-hidden="true">NEW</span><span>새 장소 {newPlaceIds.size}</span></button>}
    {view === "map" && collection && <div className="collection-map-scope"><button onClick={() => navigateCollections("collections", collection.id)}><Icon name={collection.icon} width={18} /><span>{collection.name} · {visible.length}곳</span></button><button aria-label="모음 지도 필터 해제" onClick={() => { const q = new URLSearchParams(window.location.search); q.delete("collection"); q.delete("section"); navigateShell(`/?${q}`, true); }}><Icon name="close" width={18} /></button></div>}
    {landscape && statusView}
    {landscape && regionView}
    </div>
    {!landscape && regionView}
    {!landscape && statusView}
    {view === "list" && <div ref={list} className="places-list collections-list" onScroll={(e) => { listPositions.current.set(listKey, e.currentTarget.scrollTop); if (listKey === "all:") listScroll.current = e.currentTarget.scrollTop; }}>
      <CollectionsList who={who} places={places} visible={visible} collections={data?.collections} currentId={collectionId} mode={listMode} loaded={loaded} distanceOrigin={sort === "near" ? origin : null} newPlaceIds={newPlaceIds} onNavigate={navigateCollections} onOpen={(id) => open("place", id)} onReset={reset}
        onMap={(id) => { setFocusedId(null); navigateShell(`/?collection=${encodeURIComponent(id)}&section=collections`); setMapRequest({ sequence: ++requestSequence.current, kind: "saved" }); }}
        tools={<div className="list-tools"><button className={`list-filter${category || !all ? " is-active" : ""}`} aria-label="상세 필터" aria-haspopup="dialog" aria-expanded={overlay === "filters"} onClick={() => open("filters")}><Icon name="sliders" width="16" /><span>필터</span>{(category || !all) && <span className="list-filter-count" aria-hidden="true">{(category ? 1 : 0) + (all ? 0 : 1)}</span>}</button><select aria-label="장소 정렬" value={sort} disabled={locating} onChange={(e) => e.target.value === "near" ? locate(true) : setSort("recent")}><option value="recent">최근 저장순</option><option value="near">가까운순</option></select></div>} />
    </div>}
    {view === "list" && !loaded && !error && <div className="loading-state" role="status">우리 장소를 불러오는 중…</div>}
    {view === "list" && error && !loaded && <div className="app-error" role="alert"><p>{error}</p><button className="btn" onClick={() => void store.refresh()}>다시 불러오기</button></div>}
    {view === "map" && focused && <PlaceCarousel hidden={!showPlaceCard} newPlaceIds={newPlaceIds} places={mapPlaces} selectedId={focused.id} onSelect={previewPlace} onOpen={(id) => open("place", id)} onDismiss={() => setFocusedId(null)} />}
    <div className="map-controls">{view === "map" && <><button className="saved-places-btn" disabled={!visible.length} aria-label="저장한 장소로 이동" onClick={() => { setFocusedId(null); setMapRequest({ sequence: ++requestSequence.current, kind: "saved", closer: true }); }}><Icon name="map" width="23" /></button><button className="locate-btn icon-btn" disabled={locating} aria-label="내 위치로 이동" onClick={() => { setFocusedId(null); locate(false); }}><Icon name="location" /></button></>}<ShellLink href="/add" className="save-fab" aria-label="장소 저장"><Icon name="plus" width="28" /></ShellLink></div>
    <BottomNav hidden={keyboard} current={view} mapHref={viewHref("map")} listHref={viewHref("list")} />
    {overlay === "place" && selected && <PlaceSheet key={selected.id} place={selected} kakaoKey={kakaoKey} view={view} onClose={close} onShowMap={() => showPlaceOnMap(selected)} onPatch={(patch) => store.patchPlace(selected.id, patch)} onDelete={() => { store.removePlace(selected.id); setFocusedId(null); close(); setOverlay(null); setSelectedId(null); }} />}
    {overlay === "place" && loaded && !selected && <Modal title="장소를 찾을 수 없어요" onClose={close}><p className="lead">이미 지워진 장소일 수 있어요.</p></Modal>}
    {overlay === "filters" && <Modal title="어떤 곳을 볼까요?" variant={view === "map" ? "resizable" : "compact"} initialStop={view === "map" && typeof window !== "undefined" && window.matchMedia("(orientation:landscape) and (max-height:600px)").matches ? 2 : 1} dragFromContent={view === "map"} resizeMedia={view === "map" ? "all" : undefined} className={view === "map" ? "sheet-map-filters" : ""} headerActions={view === "map" ? <button type="button" className="icon-btn filter-close-btn" aria-label="필터 닫기" onClick={close}><Icon name="close" width={18} /></button> : undefined} onClose={close} footer={<div className="actions"><button className="btn" onClick={reset}>초기화</button><button className="btn primary" onClick={close}>장소 보기</button></div>}><h3>우리의 상태</h3><div className="filter-options"><button className="chip" aria-pressed={all} onClick={() => setStatuses([...STATUS_ORDER])}>전체</button>{STATUS_ORDER.map((s) => <button key={s} className="chip" aria-pressed={!all && statuses.includes(s)} onClick={() => toggleStatus(s)}>{STATUS_LABEL[s]}</button>)}</div><h3>장소 종류</h3><div className="filter-options"><button className="chip" aria-pressed={!category} onClick={() => setCategory("")}>모든 종류</button>{categories.map((c) => <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></Modal>}
    {overlay === "pending" && <Modal title="조금만 더 확인해요" initialStop={2} onClose={close}><p className="lead">링크별로 남은 확인을 이어가세요.</p><PendingLinks sources={pending} onChanged={() => { void store.refresh(); }} /></Modal>}
  </div>;
}
