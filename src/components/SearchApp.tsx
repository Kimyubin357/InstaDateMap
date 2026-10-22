"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBoardState, useBoardSync } from "./BoardProvider";
import Icon from "./Icon";
import Modal from "./Modal";
import ShellLink from "./ShellLink";
import { PlaceSearch, unifiedResults } from "@/lib/place-search";
import { RecentSearches } from "@/lib/recent-searches";
import { requestJson } from "@/lib/client-request";
import { shareDestination } from "@/lib/share-navigation";
import type { ShareResult } from "@/lib/share-stream";
import type { KakaoPlace } from "@/lib/types";
import { navigateShell } from "@/lib/shell-navigation";

export default function SearchApp({ active, backHref, viewport }: { active: boolean; backHref: string; viewport: { keyboard: boolean; height: number; top: number } }) {
  const { store, lock } = useBoardSync(); const { access, snapshot } = useBoardState();
  const [search] = useState(() => new PlaceSearch());
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const [history] = useState(() => new RecentSearches(access!)); const [recent, setRecent] = useState(() => history.read());
  const [picked, setPicked] = useState<KakaoPlace | null>(null); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState("");
  const input = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null), scrollTop = useRef(0);
  const returnHref = useRef(backHref); const [hasSearched, setHasSearched] = useState(false);
  search.onUnauthorized = () => { void lock(); };
  const { saved, fresh } = unifiedResults(snapshot?.places || [], state.query, state.results || []);
  useEffect(() => { if (scroll.current) scroll.current.inert = !active; }, [active]);
  useEffect(() => {
    if (!active) { search.pause(); setPicked(null); if (document.activeElement === input.current) input.current?.blur(); return; }
    returnHref.current = backHref;
    const query = new URLSearchParams(window.location.search).get("q")?.slice(0, 100) ?? search.getSnapshot().query;
    if (query !== search.getSnapshot().query) search.setQuery(query);
    else { search.resume(); if (query) writeQuery(query); }
    if (scroll.current) scroll.current.scrollTop = scrollTop.current;
    // The input itself receives the original tap; never defer keyboard focus until a route effect.
    return () => search.pause();
  }, [active, search]);
  useEffect(() => {
    if (!active || !state.searched || state.searched !== state.query.trim()) return;
    const url = new URL(window.location.href); url.searchParams.set("q", state.searched);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [active, state.searched]);
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname !== "/search") return;
      const query = new URLSearchParams(window.location.search).get("q") || "";
      if (query !== search.getSnapshot().query) search.setQuery(query.slice(0, 100));
    };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, [search]);
  function writeQuery(query: string) {
    if (window.location.pathname !== "/search") return;
    const url = new URL(window.location.href); if (query.trim()) url.searchParams.set("q", query.trim()); else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }
  function record() { setRecent(history.add(state.query)); writeQuery(state.query); }
  function open() { if (!active) { returnHref.current = backHref; navigateShell("/search"); } }
  function cancel() {
    input.current?.blur(); search.setQuery(""); search.pause(); setPicked(null); setHasSearched(false);
    navigateShell(returnHref.current, true);
  }
  function changeQuery(query: string) { scrollTop.current = 0; if (scroll.current) scroll.current.scrollTop = 0; search.setQuery(query); setHasSearched(false); if (!query && window.location.pathname === "/search") window.history.replaceState(window.history.state, "", "/search"); }
  function run(query = state.query) { if (!query.trim()) return; if (query !== state.query) changeQuery(query); setRecent(history.add(query)); writeQuery(query); setHasSearched(true); void search.search(); input.current?.blur(); }
  function clear() {
    changeQuery("");
    window.history.replaceState(window.history.state, "", "/search"); input.current?.focus();
  }
  function choose(place: KakaoPlace) {
    record(); input.current?.blur(); setSaveError(""); setPicked(place);
    window.history.pushState({ ...window.history.state, datemapSearchPick: true }, "", window.location.href);
  }
  function closePick() { if (saving) return; if (window.history.state?.datemapSearchPick) window.history.back(); else setPicked(null); }
  useEffect(() => {
    const close = () => { if (!window.history.state?.datemapSearchPick) { setPicked(null); setSaveError(""); } };
    window.addEventListener("popstate", close); return () => window.removeEventListener("popstate", close);
  }, []);
  async function save() {
    if (!picked || saving) return; setSaving(true); setSaveError("");
    try {
      const result = await requestJson<ShareResult>("/api/places", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: state.searched, place_id: picked.kakao_place_id }) });
      const destination = shareDestination(result); if (!destination) throw new Error("저장 결과를 확인하지 못했어요. 다시 시도해 주세요.");
      store.acceptSavedPlace(result.saved_place);
      // Remove the confirmation-only history marker before replacing with the map.
      window.history.replaceState({ ...window.history.state, datemapSearchPick: false }, "", window.location.href);
      setPicked(null); navigateShell(destination, true);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 401) { void lock(); return; }
      setSaveError(error instanceof Error ? error.message : "저장하지 못했어요. 다시 시도해 주세요.");
    } finally { setSaving(false); }
  }
  const query = state.query.trim();
  return <div className={`search-app${active ? " is-search-active" : " is-search-idle"}${viewport.keyboard ? " keyboard-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && active && !picked) { event.preventDefault(); cancel(); } }}>
    <div className="search-content-viewport" style={active && viewport.keyboard ? { height: viewport.height, top: viewport.top, bottom: "auto" } : undefined}>
    <header className="unified-search-header">
      <form role="search" onClick={() => input.current?.focus({ preventScroll: true })} onSubmit={(e) => { e.preventDefault(); run(); }}><Icon name="search" width="20" /><input ref={input} aria-label="통합 장소 검색" placeholder="장소 이름, 지역으로 검색" value={active ? state.query : ""} onFocus={open} onChange={(e) => { open(); changeQuery(e.target.value); }} maxLength={100} enterKeyHint="search" autoComplete="off" />{active && state.query && <button type="button" className="icon-btn" aria-label="검색어 지우기" onClick={clear}><Icon name="close" width="20" /></button>}<button type="submit" className="sr-only">검색 실행</button></form>
      {active ? <button type="button" className="search-cancel" onClick={cancel}>취소</button> : <ShellLink href="/settings" className="icon-btn floating-settings" aria-label="우리 설정"><Icon name="settings" width="21" /></ShellLink>}
    </header>
    <div className="unified-search-body" aria-hidden={!active} ref={scroll} onScroll={(e) => { scrollTop.current = e.currentTarget.scrollTop; }}>
      {!query ? <section className="recent-searches"><div className="search-group-heading"><h1>최근 검색</h1>{recent.length > 0 && <button className="text-btn" onClick={() => setRecent(history.clear())}>전체 삭제</button>}</div>
        {!recent.length && <p className="search-hint">가보고 싶은 곳을 찾아보세요.<br />저장한 장소도 함께 찾을 수 있어요.</p>}
        {recent.map((term) => <div className="recent-search-row" key={term}><button className="recent-term" onClick={() => run(term)}><Icon name="clock" /><span>{term}</span></button><button className="icon-btn" aria-label={`${term} 최근 검색 삭제`} onClick={() => setRecent(history.remove(term))}><Icon name="close" width="18" /></button></div>)}
      </section> : <>
        <section aria-label="저장된 장소 검색 결과"><div className="search-group-heading"><h2>우리 지도에 저장된 곳</h2></div>
          {!snapshot ? <p className="search-hint" role="status">저장한 장소를 확인하고 있어요…</p> : !saved.length ? <p className="search-hint">저장된 장소 중에는 없어요.</p> : saved.map((place) => <button className="unified-place-row" key={place.id} onClick={() => { record(); input.current?.blur(); navigateShell(`/?place=${encodeURIComponent(place.id)}&from=search`); }}><span className="search-category"><Icon name={place.category === "카페" ? "cup" : "food"} width="20" /></span><span className="search-place-copy"><strong>{place.name}</strong><small>{[place.category, place.address].filter(Boolean).join(" · ")}</small></span><span className="saved-badge">저장됨</span><Icon name="chevron" width="17" /></button>)}
        </section>
        <section aria-label="새 장소 검색 결과"><div className="search-group-heading"><h2>새로 찾은 장소</h2></div>
          {state.busy ? <p className="search-hint" role="status">장소를 찾고 있어요…</p> : state.error ? <div className="search-failure" role="alert"><p>{state.error}</p><button className="btn" onClick={() => run()}>다시 검색</button></div> : !state.results ? <p className="search-hint">{query.length < 2 && !hasSearched ? "두 글자 이상 입력하거나 키보드의 검색을 눌러 주세요." : "입력한 이름으로 찾아볼게요…"}</p> : !fresh.length ? <p className="search-hint">{saved.length ? "추가로 찾은 장소는 없어요." : "검색 결과가 없어요. 지역이나 다른 이름으로 찾아보세요."}</p> : fresh.map((place) => <button className="unified-place-row" key={place.kakao_place_id} onClick={() => choose(place)} disabled={!snapshot}><span className="search-category"><Icon name={place.category.includes("카페") ? "cup" : "food"} width="20" /></span><span className="search-place-copy"><strong>{place.name}</strong><small>{place.address}</small></span><span className="search-add-icon" aria-label="주소 확인 후 저장"><Icon name="plus" width="21" /></span></button>)}
        </section>
      </>}
    </div>
    </div>
    {picked && active && <Modal title="여기가 맞나요?" variant="compact" onClose={closePick} footer={<div className="actions"><button className="btn" disabled={saving} onClick={closePick}>다시 고르기</button><button className="btn primary" disabled={saving} onClick={save}>{saving ? "저장 중…" : "우리 지도에 저장"}</button></div>}><div className="search-confirm"><h3>{picked.name}</h3><p className="addr">{picked.address}</p><span className="status-tag wish">가고 싶음으로 저장</span>{saveError && <p className="error" role="alert">{saveError}</p>}</div></Modal>}
  </div>;
}
