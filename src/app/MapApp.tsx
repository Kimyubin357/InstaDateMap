"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import Modal from "@/components/Modal";
import MapCanvas, { type MapPosition, type MapViewRequest } from "@/components/MapCanvas";
import PlaceSheet from "@/components/PlaceSheet";
import { requestJson, RequestError } from "@/lib/client-request";
import { STATUS_LABEL, type PlaceStatus } from "@/lib/types";
import { STATUS_ORDER, filterPlaces, sortPlaces, placeMeta, distanceM, type PlaceView } from "@/lib/place-view";
interface Pending { id: string; url: string; status: string; shared_by: string }
type Overlay = "filters" | "pending" | "place" | null;
const PENDING_LABEL: Record<string, string> = { pending_confirm: "지점 고르기", needs_review: "장소 확인하기", needs_caption: "정보 보태기" };
export default function MapApp({ who, kakaoKey }: { who: string; kakaoKey: string }) {
  const [board, setBoard] = useState("우리 데이트맵");
  const [places, setPlaces] = useState<PlaceView[]>([]); const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false); const [error, setError] = useState("");
  const [view, setView] = useState<"map" | "list">("map"); const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<PlaceStatus[]>([...STATUS_ORDER]); const [category, setCategory] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mapRequest, setMapRequest] = useState<MapViewRequest | null>(null); const requestSequence = useRef(0);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null); const [mapLocation, setMapLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sort, setSort] = useState("recent"); const [locating, setLocating] = useState(false); const [toast, setToast] = useState("");
  const [savedArrival, setSavedArrival] = useState<string | null>(null);
  const duplicateArrival = useRef(false);
  const [initialMap, setInitialMap] = useState<MapPosition>(); const [restored, setRestored] = useState(false);
  const root = useRef<HTMLDivElement>(null); const header = useRef<HTMLElement>(null); const list = useRef<HTMLDivElement>(null);
  const mapPosition = useRef<MapPosition>(); const listScroll = useRef(0); const snapshot = useRef({ view, query, statuses, category });
  snapshot.current = { view, query, statuses, category };
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("datemap-view") || "null");
      if (saved) {
        if (saved.view === "map" || saved.view === "list") setView(saved.view);
        if (typeof saved.query === "string") setQuery(saved.query);
        if (Array.isArray(saved.statuses)) setStatuses(saved.statuses.filter((s: PlaceStatus) => STATUS_ORDER.includes(s)));
        if (typeof saved.category === "string") setCategory(saved.category);
        if (saved.position && Number.isFinite(saved.position.lat) && Number.isFinite(saved.position.lng)) { setInitialMap(saved.position); mapPosition.current = saved.position; }
        listScroll.current = Number(saved.scroll) || 0;
      }
    } catch { /* A stale local view must not prevent opening the map. */ }
    setRestored(true);
    const sync = () => { const params = new URLSearchParams(window.location.search); const id = params.get("place"); setSelectedId(id); setOverlay(id ? "place" : params.get("panel") === "filters" ? "filters" : params.get("panel") === "pending" ? "pending" : null); };
    sync(); const arrival = new URLSearchParams(window.location.search); setSavedArrival(arrival.get("saved")); duplicateArrival.current = arrival.get("duplicate") === "1"; window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("popstate", sync); sessionStorage.setItem("datemap-view", JSON.stringify({ ...snapshot.current, position: mapPosition.current, scroll: listScroll.current })); };
  }, []);
  useEffect(() => {
    if (!header.current) return;
    const observer = new ResizeObserver(() => root.current?.style.setProperty("--header-height", `${header.current!.offsetHeight}px`));
    observer.observe(header.current); return () => observer.disconnect();
  }, []);
  const refresh = useCallback(async () => {
    try {
      const data = await requestJson<{ board: string; places: PlaceView[]; pending: Pending[] }>("/api/places", { cache: "no-store" });
      setBoard(data.board); setPlaces(data.places); setPending(data.pending); setLoaded(true); setError("");
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) { window.location.replace(`/enter?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      setError(e instanceof Error ? e.message : "장소를 불러오지 못했어요.");
    }
  }, []);
  useEffect(() => { refresh(); const focus = () => refresh(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  useEffect(() => { if (view === "list" && list.current) list.current.scrollTop = listScroll.current; }, [view, loaded]);
  function open(kind: Exclude<Overlay, null>, id?: string) {
    const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel");
    if (kind === "place" && id) url.searchParams.set("place", id); else url.searchParams.set("panel", kind);
    history.pushState({ ...history.state, datemapOverlay: true }, "", url.pathname + url.search);
    setSelectedId(id || null); setOverlay(kind);
    if (kind === "place" && id) setFocusedId(id);
  }
  function close() {
    if (history.state?.datemapOverlay) history.back();
    else { const url = new URL(window.location.href); url.searchParams.delete("place"); url.searchParams.delete("panel"); history.replaceState(history.state, "", url.pathname + url.search); setOverlay(null); setSelectedId(null); }
  }
  const categories = useMemo(() => [...new Set(places.map((p) => p.category).filter((s): s is string => !!s))].sort(), [places]);
  const visible = useMemo(() => sortPlaces(filterPlaces(places, query, statuses, category), sort === "near" ? origin : null), [places, query, statuses, category, sort, origin]);
  const selected = places.find((p) => p.id === selectedId);
  useEffect(() => {
    if (!loaded || !savedArrival) return;
    const place = places.find((p) => p.id === savedArrival);
    setView("map"); setQuery(""); setStatuses([...STATUS_ORDER]); setCategory("");
    setFocusedId(place?.id || null);
    setMapRequest(place ? { sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng } : { sequence: ++requestSequence.current, kind: "saved" });
    setToast(savedArrival === "0" ? "저장할 장소 없이 링크를 정리했어요." : duplicateArrival.current ? "이미 담아둔 장소예요. 기존 메모와 상태를 유지했어요." : "장소를 우리 지도에 담았어요.");
    setSavedArrival(null);
    const url = new URL(window.location.href); url.searchParams.delete("saved"); url.searchParams.delete("duplicate");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [loaded, places, savedArrival]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  function showPlaceOnMap(place: PlaceView) {
    if (!visible.some((p) => p.id === place.id)) reset();
    setView("map"); setFocusedId(place.id);
    setMapRequest({ sequence: ++requestSequence.current, kind: "place", lat: place.lat, lng: place.lng });
    close();
  }
  function locate(forSort = false) {
    if (!navigator.geolocation) { setToast("이 기기에서는 위치를 확인할 수 없어요."); return; }
    setLocating(true); setToast("");
    navigator.geolocation.getCurrentPosition((p) => { const value = { lat: p.coords.latitude, lng: p.coords.longitude }; setOrigin(value); if (forSort) setSort("near"); else setMapLocation(value); setLocating(false); },
      () => { setLocating(false); setToast("위치를 확인하지 못했어요. 위치 권한을 확인하거나 최근 저장순으로 봐 주세요."); }, { timeout: 12000, maximumAge: 30000 });
  }
  function reset() { setQuery(""); setStatuses([...STATUS_ORDER]); setCategory(""); }
  const all = statuses.length === STATUS_ORDER.length;
  return <div ref={root} className={`app-root view-${view}`}>
    <div className={`map-surface ${view === "list" ? "hidden-map" : ""}`} aria-hidden={view !== "map"}>{restored && <MapCanvas places={visible} selectedId={selectedId || focusedId} apiKey={kakaoKey} active={view === "map"} initialPosition={initialMap} onPosition={(p) => { mapPosition.current = p; }} onPick={(id) => open("place", id)} location={mapLocation} viewRequest={mapRequest} />}</div>
    <header ref={header} className="app-header"><div className="app-title"><h1>{board}</h1><Link href="/settings" className="icon-btn" aria-label="우리 설정"><Icon name="settings" /></Link></div>
      <div className="saved-search"><Icon name="search" /><input aria-label="저장한 장소 찾기" placeholder="저장한 장소 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button className="icon-btn" aria-label="검색 지우기" onClick={() => setQuery("")}><Icon name="close" width="18" /></button>}</div>
      <div className="view-tools"><div className="seg two view-switch" aria-label="보는 방식"><button aria-pressed={view === "map"} onClick={() => setView("map")}>지도</button><button aria-pressed={view === "list"} onClick={() => setView("list")}>리스트</button></div><button className="icon-btn bordered" aria-label="상세 필터" onClick={() => open("filters")}><Icon name="sliders" />{(category || !all) && <i className="filter-dot" />}</button></div>
      <div className="chips" aria-label="빠른 상태 필터"><button className="chip" aria-pressed={all} onClick={() => setStatuses([...STATUS_ORDER])}>전체</button>{(["wish", "visited"] as PlaceStatus[]).map((s) => <button className="chip" key={s} aria-pressed={statuses.length === 1 && statuses[0] === s} onClick={() => setStatuses([s])}>{STATUS_LABEL[s]}</button>)}{category && <button className="chip" aria-pressed="true" onClick={() => setCategory("")}>{category}<Icon name="close" width="14" /></button>}</div>
      {pending.length > 0 && <button className="pending-notice" onClick={() => open("pending")}><span>마저 확인할 링크 {pending.length}개</span><Icon name="chevron" width="16" /></button>}
    </header>
    {view === "list" && <div ref={list} className="places-list" onScroll={(e) => { listScroll.current = e.currentTarget.scrollTop; }}><div className="list-heading"><h2>저장한 장소</h2><select aria-label="장소 정렬" value={sort} disabled={locating} onChange={(e) => e.target.value === "near" ? locate(true) : setSort("recent")}><option value="recent">최근 저장순</option><option value="near">가까운순</option></select></div>
      {visible.map((p) => <button key={p.id} className="place-row" onClick={() => open("place", p.id)}><span className={`category-icon ${p.category === "카페" ? "cafe" : "food"}`}><Icon name={p.category === "카페" ? "cup" : "food"} width="28" height="28" /></span><span className="row-copy"><strong>{p.name}</strong><span className="row-meta">{placeMeta(p)}{sort === "near" && origin ? ` · ${(distanceM(origin, p) / 1000).toFixed(1)}km` : ""}</span><span className={`status-tag ${p.status}`}>{STATUS_LABEL[p.status]}</span><small className="row-sharer"><Icon name="user" width="12" height="12" />{p.sharers.length >= 2 ? "둘 다 저장함" : p.sharers[0] ? `${p.sharers[0]}님이 저장` : `${who}님의 장소`}</small></span><Icon name="chevron" width="18" /></button>)}
    </div>}
    {loaded && !error && visible.length === 0 && <div className={`empty-state ${view === "map" ? "on-map" : "on-list"}`}><Icon name="heart" width="36" height="36" /><h2>{places.length ? "아직 맞는 장소가 없어요" : "우리의 첫 장소를 담아봐요"}</h2><p>{places.length ? "검색어나 필터를 조금 바꿔볼까요?" : "인스타에서 발견한 곳도, 이미 아는 곳도 좋아요."}</p>{places.length > 0 && <button className="text-btn" onClick={reset}>검색·필터 초기화</button>}</div>}
    {!loaded && !error && <div className="loading-state" role="status">우리 장소를 불러오는 중…</div>}
    {error && <div className="app-error" role="alert"><p>{error}</p><button className="btn" onClick={refresh}>다시 불러오기</button></div>}
    <div className="map-controls">{view === "map" && <><button className="saved-places-btn" disabled={!visible.length} aria-label="저장한 장소로 이동" onClick={() => { setFocusedId(null); setMapRequest({ sequence: ++requestSequence.current, kind: "saved" }); }}><Icon name="pin" width="19" /><span>저장한 곳</span></button><button className="locate-btn icon-btn" disabled={locating} aria-label="내 위치로 이동" onClick={() => locate(false)}><Icon name="location" /></button></>}<Link href="/add" className="save-fab"><Icon name="plus" width="24" /><span>장소 저장</span></Link></div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-btn" aria-label="알림 닫기" onClick={() => setToast("")}><Icon name="close" width="16" /></button></div>}
    {overlay === "place" && selected && <PlaceSheet key={selected.id} place={selected} onClose={close} onShowMap={() => showPlaceOnMap(selected)} onPatch={(patch) => setPlaces((ps) => ps.map((p) => p.id === selected.id ? { ...p, ...patch } : p))} onDelete={() => { setPlaces((ps) => ps.filter((p) => p.id !== selected.id)); close(); }} />}
    {overlay === "place" && loaded && !selected && <Modal title="장소를 찾을 수 없어요" onClose={close}><p className="lead">이미 지워진 장소일 수 있어요.</p></Modal>}
    {overlay === "filters" && <Modal title="어떤 곳을 볼까요?" variant="compact" onClose={close} footer={<div className="actions"><button className="btn" onClick={reset}>초기화</button><button className="btn primary" onClick={close}>장소 보기</button></div>}><h3>우리의 상태</h3><div className="filter-options">{STATUS_ORDER.map((s) => <button key={s} className="chip" aria-pressed={statuses.includes(s)} onClick={() => setStatuses((current) => current.includes(s) ? current.filter((v) => v !== s) : [...current, s])}>{STATUS_LABEL[s]}</button>)}</div><h3>장소 종류</h3><div className="filter-options"><button className="chip" aria-pressed={!category} onClick={() => setCategory("")}>모든 종류</button>{categories.map((c) => <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></Modal>}
    {overlay === "pending" && <Modal title="조금만 더 확인해요" onClose={close}><p className="lead">지점을 고르거나 장소 정보를 보태면 저장할 수 있어요.</p><div className="pending-list">{pending.map((p) => <Link key={p.id} href={`/confirm/${p.id}`} className="pending-row"><div><strong>{PENDING_LABEL[p.status] || "장소 확인하기"}</strong><small>{p.shared_by}님이 발견한 링크</small><span>{p.url.replace("https://www.instagram.com/", "")}</span></div><Icon name="chevron" /></Link>)}</div></Modal>}
  </div>;
}
