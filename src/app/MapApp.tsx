"use client";
import CollectionsList from "@/components/CollectionsList";
import useNewPlaceIds from "@/components/useNewPlaceIds";
import PendingLinks from "@/components/PendingLinks";
import JustSavedSheet from "@/components/JustSavedSheet";
import { takeJustSaved, type JustSaved } from "@/lib/saved-memory";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SEARCH_TOOLS_ID } from "@/lib/search-tools";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import { CollectionCover } from "@/components/Palette";
import Modal from "@/components/Modal";
import MapCanvas, { type MapInsets, type MapPosition, type MapRecovery, type MapViewRequest, type RegionSelection } from "@/components/MapCanvas";
import RegionPlacesList from "@/components/RegionPlacesList";
import MapStatus, { useLandscape, type MapStatusContent } from "@/components/MapStatus";
import PlaceSheet from "@/components/PlaceSheet";
import BottomNav from "@/components/BottomNav";
import ShellLink from "@/components/ShellLink";
import PlaceCarousel from "@/components/PlaceCarousel";
import { useBoardState, useBoardSync } from "@/components/BoardProvider";
import useScopePlaces from "@/components/useScopePlaces";
import AllPlacesList from "@/components/AllPlacesList";
import { NewPlacesSheet, PlaceRoomsLine, RoomScopeButton, RoomsSheet, type NewRoomEntry } from "@/components/Rooms";
import type { MapRoomLook } from "@/components/MapCanvas";
import { newPlacesByRoom, type MapPlace, type RoomSummary } from "@/lib/rooms";
import { friendlyMessage } from "@/lib/client-request";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { PLACE_STATUS_ENABLED } from "@/lib/features";
import { DEFAULT_STATUSES, STATUS_ORDER, filterPlaces, sortPlaces, type PlaceView } from "@/lib/place-view";
import { navigateShell } from "@/lib/shell-navigation";
type Overlay = "filters" | "pending" | "place" | "rooms" | "new" | null;
const PANELS = ["filters", "pending", "rooms", "new"] as const;
const panelOf = (value: string | null): Overlay => (PANELS as readonly string[]).includes(value ?? "") ? value as Overlay : null;
/** 방을 바꾼 직후(지도를 새로 열 수도 있음) 그 범위의 장소에 지도를 맞춥니다. */
let fitAfterScope = false;
export default function MapApp({ who, kakaoKey, active, keyboard, onViewChange }: { who: string; kakaoKey: string; active: boolean; keyboard: boolean; onViewChange: (href: string) => void }) {
  const router = useRouter();
  const { store, notify, rooms: roomsStore, chooseScope } = useBoardSync(); const { snapshot: data, error: roomError, syncing } = useBoardState();
  // 보는 범위(2026-11-25 방 고르기·전체 보기): 전체 = 모든 방의 장소(같은 가게는 핀 하나), 방 = 이 기기가 연 방.
  const scope = useScopePlaces(); const { isAll, flat, repOf, roomById, order: roomOrder, rooms: roomsState } = scope;
  const places: MapPlace[] = scope.grouped, pending = data?.pending || []; const board = data?.board || "이 방", loaded = scope.loaded;
  const error = isAll ? (roomsState.all ? "" : roomsState.allError || roomError) : roomError;
  const refresh = () => { if (isAll) void roomsStore.loadAll(); void store.refresh(); };
  /** 방마다의 NEW(보면 사라지고, 안 봐도 24시간 뒤에 사라짐). 지도·리스트는 같은 가게를 묶은 대표 장소 기준. */
  const newFlatIds = useNewPlaceIds(flat, roomsState.seen);
  const newPlaceIds = useMemo(() => isAll ? new Set(places.filter((p) => (p.group_ids ?? [p.id]).some((id) => newFlatIds.has(id))).map((p) => p.id)) : newFlatIds, [isAll, places, newFlatIds]);
  const repId = (id: string) => repOf.get(id) ?? id;
  const groupIds = (id: string) => places.find((p) => p.id === repId(id))?.group_ids ?? [id];
  const openRoom = data?.boardId ?? null;
  const currentRoom: RoomSummary | undefined = openRoom ? roomById.get(openRoom) : undefined;
  const navigation = useSearchParams().toString();
  const params = new URLSearchParams(navigation);
  const collectionId = isAll ? null : params.get("collection");
  const section = params.get("section");
  const listMode = isAll ? (section === "rooms" ? "rooms" : "all") : section === "collections" || collectionId ? "collections" : "all";
  const collection = collectionId ? data?.collections?.find((c) => c.id === collectionId) : undefined;
  function viewHref(target: "map" | "list") {
    const q = new URLSearchParams(); if (target === "list") q.set("view", "list");
    if (collectionId) q.set("collection", collectionId);
    if (listMode !== "all") q.set("section", listMode);
    return "/" + (q.size ? `?${q}` : "");
  }
  function navigateCollections(mode: "all" | "collections" | "rooms", id?: string) {
    const q = new URLSearchParams({ view: "list" }); if (mode !== "all") q.set("section", mode); if (id) q.set("collection", id);
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
  /** Card deck opened from a region list: only that area's places, in the list's order. null = every place on the map. */
  const [deck, setDeck] = useState<string[] | null>(null);
  const [mapRequest, setMapRequest] = useState<MapViewRequest | null>(null); const requestSequence = useRef(0);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null); const [mapLocation, setMapLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sort, setSort] = useState("recent"); const [locating, setLocating] = useState(false);
  const [savedArrival, setSavedArrival] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<JustSaved | null>(null);
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
        if (PLACE_STATUS_ENABLED && Array.isArray(saved.statuses)) setStatuses(saved.statuses.filter((s: PlaceStatus) => STATUS_ORDER.includes(s)));
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
      setSelectedId(id); setOverlay(id ? "place" : panelOf(params.get("panel")));
    };
    window.addEventListener("popstate", syncOverlay);
    return () => window.removeEventListener("popstate", syncOverlay);
  }, []);
  useEffect(() => {
    if (!active) { setOverlay(null); return; }
    const params = new URLSearchParams(navigation), id = params.get("place");
    setView(params.get("view") === "list" ? "list" : "map");
    if (id) setFocusedId(repId(id));
    setSelectedId(id); setOverlay(id ? "place" : panelOf(params.get("panel")));
    const saved = params.get("saved") || params.get("restored"); setSavedArrival(saved); duplicateArrival.current = params.get("duplicate") === "1"; restoredArrival.current = !!params.get("restored");
    // Successful saves already supply this place. Only old responses / direct URLs need a fetch.
    if (saved && !store.getSnapshot().snapshot?.places.some((p) => p.id === saved)) void store.refresh();
  // repOf changes with every place list; the overlay only follows navigation.
  }, [active, navigation, store]);
  useEffect(() => { if (view === "list" && list.current) list.current.scrollTop = listPositions.current.get(listKey) ?? (listKey === "all:" ? listScroll.current : 0); }, [view, loaded, listKey]);
  function open(kind: Exclude<Overlay, null>, id?: string) {
    const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel");
    if (kind === "place" && id) url.searchParams.set("place", id); else url.searchParams.set("panel", kind);
    history.pushState({ ...history.state, datemapOverlay: true }, "", url.pathname + url.search);
    setSelectedId(id || null); setOverlay(kind);
    if (kind === "place" && id) setFocusedId(repId(id));
  }
  function close() {
    if (new URLSearchParams(window.location.search).get("from") === "search") router.back();
    else if (history.state?.datemapOverlay) history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel"); history.replaceState(history.state, "", url.pathname + url.search); setOverlay(null); setSelectedId(null); }
  }
  const categories = useMemo(() => [...new Set(places.map((p) => p.category).filter((s): s is string => !!s))].sort(), [places]);
  const scopedPlaces = useMemo(() => { if (!collection) return places; const ids = new Set(collection.place_ids); return places.filter((p) => ids.has(p.id)); }, [places, collection]);
  // 종류 거르기는 리스트에만 있습니다(지도에는 두지 않음, 2026-11-25).
  const visible = useMemo(() => sortPlaces(filterPlaces(scopedPlaces, "", statuses, category), sort === "near" ? origin : null) as MapPlace[], [scopedPlaces, statuses, category, sort, origin]);
  const mapVisible = useMemo(() => filterPlaces(scopedPlaces, "", statuses, "") as MapPlace[], [scopedPlaces, statuses]);
  const selected = flat.find((p) => p.id === selectedId);
  const selectedRep = selected ? places.find((p) => p.id === repId(selected.id)) : undefined;
  const searchDetail = new URLSearchParams(navigation).get("from") === "search";
  const mapPlaces = useMemo(() => searchDetail && selectedRep && !mapVisible.some((p) => p.id === selectedRep.id) ? [...mapVisible, selectedRep] : mapVisible, [searchDetail, selectedRep, mapVisible]);
  const deckPlaces = useMemo(() => {
    if (!deck || !focusedId || !deck.includes(focusedId)) return mapPlaces;
    const byId = new Map(mapPlaces.map((p) => [p.id, p]));
    const list = deck.map((id) => byId.get(id)).filter((p): p is PlaceView => !!p);
    return list.length ? list : mapPlaces;
  }, [deck, focusedId, mapPlaces]);
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
    const found = flat.find((p) => p.id === savedArrival);
    const place = found ? places.find((p) => p.id === repId(found.id)) ?? found : undefined;
    if (!place && (syncing || error || !["0", "1"].includes(savedArrival))) return;
    setView("map");
    if (!restoredArrival.current || !mapVisible.some((p) => p.id === place?.id)) { setStatuses(statusesShowing(place)); setCategory(""); }
    // 등록 화면에서 방금 담은 곳(시안 9번): 칩 "'방'에 N곳을 담았어요" + '방금 담은 N곳' 시트. 시트가 장소 카드 자리를 씁니다.
    const fresh = !restoredArrival.current && savedArrival !== "0" && !duplicateArrival.current && data ? takeJustSaved(data.boardId) : null;
    const arrived = fresh && (savedArrival === "1" || fresh.ids.includes(savedArrival)) ? fresh : null;
    setJustSaved(arrived);
    setFocusedId(arrived ? null : place?.id || null);
    setMapRequest(place ? { sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng, smooth: true, level: 3 } : { sequence: ++requestSequence.current, kind: "saved" });
    if (!restoredArrival.current) notify(savedArrival === "0" ? "저장 없이 링크를 정리했어요." : duplicateArrival.current ? "이미 저장한 장소예요." : arrived ? `‘${board}’에 ${arrived.ids.length}곳을 담았어요.` : "장소를 저장했어요.");
    setSavedArrival(null);
    const url = new URL(window.location.href); url.searchParams.delete("saved"); url.searchParams.delete("duplicate"); url.searchParams.delete("restored"); url.searchParams.delete("view"); url.searchParams.delete("collection"); url.searchParams.delete("section");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [active, loaded, places, savedArrival, syncing, error]);
  function showPlaceOnMap(place: PlaceView) {
    if (!mapVisible.some((p) => p.id === repId(place.id))) setStatuses(statusesShowing(place));
    setView("map"); setFocusedId(repId(place.id));
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
  /** `scope`: a region list's order to page through, null to page through every place, omitted to keep the current deck. */
  function previewPlace(target: string, scope?: string[] | null) {
    const id = repId(target);
    const place = mapPlaces.find((item) => item.id === id); if (!place) return;
    if (scope !== undefined) setDeck(scope);
    setJustSaved(null); setFocusedId(id);
    setMapRequest({ sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng, smooth: true });
  }
  /** Map area left free by search, chips, an open region list and the bottom navigation. */
  function fitPadding(): MapInsets | null {
    const box = root.current?.getBoundingClientRect(); if (!box) return null;
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const stackTop = [...(root.current?.querySelectorAll(".map-chip-stack>:not(.region-sheet):not(.map-status-card)") ?? [])].reduce((bottom, el) => Math.max(bottom, el.getBoundingClientRect().bottom), rect(".unified-search-header")?.bottom ?? box.top + 80);
    const sheet = root.current?.querySelector<HTMLElement>(".region-sheet, .just-saved-sheet")?.getBoundingClientRect();
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
    : loaded && !error && mapVisible.length === 0 ? (places.length ? "filtered" : "empty") : null;
  // Closing hides one occurrence; the same situation arising again (or with another filter) shows it again.
  const statusSignature = statusKind ? `${statusKind}:${statusKind === "filtered" ? `${statuses.join(",")}|${category}|${collectionId ?? ""}` : statusKind === "error" ? error : ""}` : "";
  useEffect(() => { setDismissedStatus(null); }, [statusSignature]);
  const status: MapStatusContent | null = !statusKind || dismissedStatus === statusSignature ? null
    : statusKind === "loading" ? { tone: "info", icon: "heart", title: "장소를 불러오는 중…", closable: false }
    : statusKind === "error" ? { tone: "error", icon: "close", title: "장소를 불러오지 못했어요", message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.", closable: true,
      actions: <button type="button" className="btn primary" onClick={refresh}>다시 시도</button> }
    : statusKind === "map-loading" ? { tone: "info", icon: "pin", title: "지도를 다시 불러오는 중…", closable: false }
    : statusKind === "map-error" ? { tone: "error", icon: "close", title: "지도를 불러오지 못했어요", message: "잠시 후 다시 시도하거나, 저장한 장소를 리스트로 볼 수 있어요.", closable: true,
      actions: <>{mapRecovery?.retry && <button type="button" className="btn primary" onClick={mapRecovery.retry}>다시 시도</button>}<button type="button" className="btn" onClick={() => navigateShell(viewHref("list"))}>리스트로 보기</button></> }
    : statusKind === "empty" ? { tone: "info", icon: "heart", title: "첫 장소를 담아 봐요", message: "인스타에서 발견한 곳도, 이미 아는 곳도 좋아요.", closable: true,
      actions: <ShellLink href="/add" className="btn primary">장소 추가</ShellLink> }
    : { tone: "info", icon: "heart", title: "아직 맞는 장소가 없어요", message: "필터를 조금 바꿔볼까요?", closable: true,
      actions: <button type="button" className="btn primary" onClick={reset}>필터 초기화</button> };
  const regionView = regionSelection && regionPlaces.length > 0 && view === "map" && <RegionPlacesList label={regionSelection.label} places={regionPlaces} newPlaceIds={newPlaceIds}
    onClose={() => setRegionSelection(null)} onPick={(id, order) => { setRegionSelection(null); previewPlace(id, order); }} />;
  const statusView = status && <MapStatus status={status} landscape={landscape} onClose={() => setDismissedStatus(statusSignature)} />;
  const showPlaceCard = view === "map" && !!focused && !(overlay === "place" && selected);
  const justPlaces = useMemo(() => justSaved ? justSaved.ids.map((id) => flat.find((p) => p.id === id)).filter((p): p is (typeof flat)[number] => !!p) : [], [justSaved, flat]);
  const showJustSaved = active && view === "map" && !overlay && !regionSelection && justPlaces.length > 0;
  const all = statuses.length === STATUS_ORDER.length;
  // 본 장소(NEW가 사라짐): 장소 카드나 상세를 열면 그 가게의 모든 방 기록을 본 것으로 적습니다.
  useEffect(() => {
    const ids = [...(focusedId ? groupIds(focusedId) : []), ...(overlay === "place" && selectedId ? groupIds(selectedId) : [])].filter((id) => newFlatIds.has(id));
    if (ids.length) roomsStore.markSeen(ids);
  }, [focusedId, selectedId, overlay, newFlatIds, roomsStore]);
  // 방을 바꾸면(전체 ↔ 방) 그 범위의 장소에 지도를 맞춥니다. 방을 새로 열어 지도를 다시 만든 경우도 포함합니다.
  const scopeKey = `${roomsState.scope}:${openRoom ?? ""}`, lastScope = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !openRoom) return;
    // 처음 열 때는 지난 지도 위치를 그대로 둡니다(방을 골라 지도를 새로 연 경우만 맞춤).
    if (lastScope.current === null) { lastScope.current = scopeKey; if (!fitAfterScope) return; }
    if (lastScope.current === scopeKey && !fitAfterScope) return;
    if (!mapVisible.length) return;
    lastScope.current = scopeKey; fitAfterScope = false;
    setFocusedId(null); setRegionSelection(null); setDeck(null);
    setMapRequest({ sequence: ++requestSequence.current, kind: "saved" });
  }, [scopeKey, loaded, openRoom, mapVisible.length]);
  /** 지도 핀·지역 카드의 방 색: 전체 = 장소마다 그 방 색(여러 방이면 나눈 색), 방 안 = 그 방 색 */
  const look = useMemo<MapRoomLook | undefined>(() => roomsState.rooms ? {
    all: isAll, order: roomOrder, colorOf: (room) => roomById.get(room)?.color,
    roomsOf: (place) => (place as MapPlace).room_ids ?? [(place as MapPlace).board_id || openRoom || ""],
  } : undefined, [roomsState.rooms, isAll, roomOrder, roomById, openRoom]);
  const scopeName = isAll ? "전체" : currentRoom?.name ?? board;
  const scopeColors = isAll ? (roomsState.rooms ?? []).map((r) => r.color) : [currentRoom?.color];
  // 새 장소 시트: 새 장소가 있는 방(방 안에서는 이 방 하나)
  const roomFor = (id: string): RoomSummary => roomById.get(id) ?? { id, name: id === openRoom ? board : "방", color: "red", role: "member", member_name: who, member_count: 1, member_limit: 8, place_count: flat.filter((p) => p.board_id === id).length, collection_count: 0, member_ids: [], member_names: [] };
  const newEntries: NewRoomEntry[] = useMemo(() => newPlacesByRoom(flat, newFlatIds, isAll ? roomsState.rooms ?? [] : openRoom ? [{ id: openRoom }] : [])
    .map((e) => ({ room: roomFor(e.room), places: e.places })),
  [flat, newFlatIds, isAll, roomsState.rooms, openRoom, roomById]);
  const newCount = newEntries.reduce((sum, e) => sum + e.places.length, 0);
  /** 전체 보기에서 다른 방의 장소: 그 방의 내 이름·멤버로 삭제 권한을 보고, 요청은 그 방으로 보냅니다. */
  const selectedRoom = selected && isAll && selected.board_id && selected.board_id !== openRoom ? roomById.get(selected.board_id) : undefined;
  const selectedRooms = isAll && selectedRep ? (selectedRep.room_ids ?? [selected?.board_id ?? ""]).map((id) => roomById.get(id)).filter((r): r is RoomSummary => !!r) : [];
  async function pickScope(target: "all" | string) {
    const same = target === "all" ? isAll : !isAll && target === openRoom;
    close();
    if (same) return;
    fitAfterScope = true;
    try {
      if (await chooseScope(target)) notify(target === "all" ? "모든 방의 장소를 함께 봐요." : `‘${roomById.get(target)?.name ?? "방"}’ 방을 봐요.`, "info");
      else fitAfterScope = false;
    } catch (e) { fitAfterScope = false; notify(friendlyMessage(e, "방을 바꾸지 못했어요. 다시 시도해 주세요."), "error"); }
  }
  function enterRoom(id: string) {
    navigateShell("/?view=list", true);
    void pickScopeFromList(id);
  }
  async function pickScopeFromList(id: string) {
    fitAfterScope = true;
    try { if (!await chooseScope(id)) fitAfterScope = false; }
    catch (e) { fitAfterScope = false; notify(friendlyMessage(e, "방에 들어가지 못했어요. 다시 시도해 주세요."), "error"); }
  }
  const roomButton = searchTools && createPortal(<RoomScopeButton name={scopeName} colors={scopeColors} open={overlay === "rooms"} onClick={() => open("rooms")} />, searchTools);
  const kindTool = <div className="list-tools"><button className={`list-filter kind-chip${category || !all ? " is-active" : ""}`} aria-label={category ? `종류: ${category}. 종류 바꾸기` : "종류로 거르기"} aria-haspopup="dialog" aria-expanded={overlay === "filters"} onClick={() => open("filters")}><span>{category || "종류"}</span><Icon name="chevron" width="14" className="list-filter-chevron" /></button><select aria-label="장소 정렬" value={sort} disabled={locating} onChange={(e) => e.target.value === "near" ? locate(true) : setSort("recent")}><option value="recent">최근 저장순</option><option value="near">가까운순</option></select></div>;
  return <div ref={root} className={`app-root view-${view}${pending.length ? " has-pending-links" : ""}${showPlaceCard ? " has-place-card" : ""}${showJustSaved ? " has-just-saved" : ""}`}>
    <div className={`map-surface ${view === "list" ? "hidden-map" : ""}${mapRecovery && !mapRecovery.loading ? " is-map-failed" : ""}`} aria-hidden={view !== "map"}>{restored && <MapCanvas newPlaceIds={newPlaceIds} places={mapPlaces} selectedId={(selectedId && repId(selectedId)) || focusedId} apiKey={kakaoKey} active={active && view === "map"} initialPosition={initialMap} onPosition={(p) => { mapPosition.current = p; }} onPick={(id) => previewPlace(id, null)} onBlank={() => { if (!overlay) setFocusedId(null); }} location={mapLocation} viewRequest={mapRequest} focusPadding={focusPadding} onShowList={() => navigateShell(viewHref("list"))} onRecovery={setMapRecovery} allPlaces={places} fitPadding={fitPadding} look={look} onRegionOpen={(selection) => { setFocusedId(null); setJustSaved(null); setRegionSelection(selection); }} />}</div>
    <h1 className="sr-only">{isAll ? "모든 방" : board}</h1>
    {active && roomButton}
    <div className="map-chip-stack">
    {pending.length > 0 && <button className="pending-map-badge" onClick={() => open("pending")} aria-label={`마저 확인할 링크 ${pending.length}개`}><Icon name="link" width="16" /><span>확인 대기 {pending.length}</span></button>}
    {view === "map" && newCount > 0 && <button type="button" className={`new-places-chip${overlay === "new" ? " is-open" : ""}`} aria-haspopup="dialog" aria-expanded={overlay === "new"} aria-label={`새 장소 ${newCount}곳 보기`} onClick={() => open("new")}><span className="new-place-badge" aria-hidden="true">NEW</span><span>새 장소 {newCount}</span></button>}
    {view === "map" && collection && <div className="collection-map-scope"><button onClick={() => navigateCollections("collections", collection.id)}><CollectionCover color={collection.color} icon={collection.icon} size={28} /><span>{collection.name} · {mapVisible.length}곳</span></button><button aria-label="모음 지도 필터 해제" onClick={() => { const q = new URLSearchParams(window.location.search); q.delete("collection"); q.delete("section"); navigateShell(`/?${q}`, true); }}><Icon name="close" width={18} /></button></div>}
    {landscape && statusView}
    {landscape && regionView}
    </div>
    {!landscape && regionView}
    {!landscape && statusView}
    {view === "list" && <div ref={list} className="places-list collections-list" onScroll={(e) => { listPositions.current.set(listKey, e.currentTarget.scrollTop); if (listKey === "all:") listScroll.current = e.currentTarget.scrollTop; }}>
      {isAll ? <AllPlacesList mode={listMode === "rooms" ? "rooms" : "all"} places={visible} total={places.length} rooms={roomsState.rooms} roomsError={roomsState.roomsError} loaded={loaded} tools={kindTool} newPlaceIds={newPlaceIds} distanceOrigin={sort === "near" ? origin : null}
        onNavigate={navigateCollections} onOpen={(id) => open("place", id)} onEnterRoom={enterRoom} onReset={reset} />
      : <CollectionsList who={who} places={places} visible={visible} collections={data?.collections} currentId={collectionId} mode={listMode === "collections" ? "collections" : "all"} loaded={loaded} distanceOrigin={sort === "near" ? origin : null} newPlaceIds={newPlaceIds} onNavigate={navigateCollections} onOpen={(id) => open("place", id)} onReset={reset}
        onMap={(id) => { setFocusedId(null); navigateShell(`/?collection=${encodeURIComponent(id)}&section=collections`); setMapRequest({ sequence: ++requestSequence.current, kind: "saved" }); }}
        tools={kindTool} />}
    </div>}
    {view === "list" && !loaded && !error && <div className="loading-state" role="status">장소를 불러오는 중…</div>}
    {view === "list" && error && !loaded && <div className="app-error" role="alert"><p>{error}</p><button className="btn" onClick={refresh}>다시 불러오기</button></div>}
    {showJustSaved && <JustSavedSheet room={board} places={justPlaces} url={justSaved?.url ?? null} onOpen={(id) => open("place", id)} onClose={() => setJustSaved(null)} />}
    {view === "map" && focused && <PlaceCarousel hidden={!showPlaceCard} newPlaceIds={newPlaceIds} places={deckPlaces} selectedId={focused.id} onSelect={previewPlace} onOpen={(id) => open("place", id)} onDismiss={() => setFocusedId(null)} />}
    <div className="map-controls">{view === "map" && <><button className="saved-places-btn" disabled={!mapVisible.length} aria-label="저장한 장소로 이동" onClick={() => { setFocusedId(null); setMapRequest({ sequence: ++requestSequence.current, kind: "saved", closer: true }); }}><Icon name="map" width="23" /></button><button className="locate-btn icon-btn" disabled={locating} aria-label="내 위치로 이동" onClick={() => { setFocusedId(null); locate(false); }}><Icon name="location" /></button></>}<ShellLink href="/add" className="save-fab" aria-label="장소 저장"><Icon name="plus" width="28" /></ShellLink></div>
    <BottomNav hidden={keyboard} current={view} mapHref={viewHref("map")} listHref={viewHref("list")} />
    {overlay === "place" && selected && <PlaceSheet key={selected.id} place={selected} kakaoKey={kakaoKey} view={view} onClose={close} onShowMap={() => showPlaceOnMap(selected)}
      room={selectedRoom ? { id: selectedRoom.id, who: selectedRoom.member_name, memberNames: selectedRoom.member_names, memberIds: selectedRoom.member_ids } : undefined}
      rooms={selectedRooms.length > 0 ? <PlaceRoomsLine rooms={selectedRooms} /> : undefined}
      onOrganize={isAll ? () => { const room = selected.board_id; navigateShell(`/?view=list&organize=${encodeURIComponent(selected.id)}`, true); void pickScopeFromList(room); } : undefined}
      onPatch={(patch) => { if (selectedRoom) roomsStore.patchPlace(selected.id, patch); else store.patchPlace(selected.id, patch); }}
      onDelete={() => { if (selectedRoom) roomsStore.removePlace(selected.id); else store.removePlace(selected.id); setFocusedId(null); close(); setOverlay(null); setSelectedId(null); }} />}
    {overlay === "place" && loaded && !selected && <Modal title="장소를 찾을 수 없어요" onClose={close}><p className="lead">이미 지워진 장소일 수 있어요.</p></Modal>}
    {overlay === "filters" && <Modal title="어떤 종류를 볼까요?" variant="compact" onClose={close} footer={<div className="actions"><button className="btn" onClick={reset}>초기화</button><button className="btn primary" onClick={close}>장소 보기</button></div>}>{PLACE_STATUS_ENABLED && <><h3>상태</h3><div className="filter-options"><button className="chip" aria-pressed={all} onClick={() => setStatuses([...STATUS_ORDER])}>전체</button>{STATUS_ORDER.map((s) => <button key={s} className="chip" aria-pressed={!all && statuses.includes(s)} onClick={() => toggleStatus(s)}>{STATUS_LABEL[s]}</button>)}</div></>}<h3>장소 종류</h3><div className="filter-options"><button className="chip" aria-pressed={!category} onClick={() => setCategory("")}>모든 종류</button>{categories.map((c) => <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></Modal>}
    {overlay === "pending" && <Modal title="확인 대기" initialStop={2} onClose={close}><PendingLinks sources={pending} room={board} onChanged={() => { void store.refresh(); }} /></Modal>}
    {overlay === "rooms" && <RoomsSheet rooms={roomsState.rooms} scope={roomsState.scope} current={openRoom} error={roomsState.rooms ? "" : roomsState.roomsError} onPick={pickScope} onClose={close} />}
    {overlay === "new" && <NewPlacesSheet entries={newEntries} scope={roomsState.scope} onClose={close}
      onPlace={(p) => { close(); setView("map"); setJustSaved(null); setRegionSelection(null); previewPlace(p.id, null); }}
      onAllSeen={(entry) => { roomsStore.markSeen(entry.places.map((p) => p.id)); notify(`‘${entry.room.name}’의 새 장소를 모두 본 걸로 했어요.`, "info"); }}
      onRoomMap={(entry) => {
        const points = entry.places.map((p) => ({ lat: p.lat, lng: p.lng }));
        if (isAll) { void pickScope(entry.room.id); return; }
        close(); setFocusedId(null); setMapRequest({ sequence: ++requestSequence.current, kind: "bounds", points });
      }} />}
  </div>;
}
